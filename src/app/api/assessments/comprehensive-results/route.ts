import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import { getUserFromRequest } from '@/lib/auth';
import User from '@/models/User';
import Assessment from '@/models/Assessment';
import { getAIAnalysis } from '@/lib/ai-services';
import { AssessmentType } from '@/models/Assessment';

// Define the assessment data interface expected by the AI service
interface AssessmentData {
  type: AssessmentType;
  responses: Array<{
    questionId: string;
    response: string | number;
  }>;
}

// Define assessment document with responses
interface AssessmentWithResponses {
  _id: string;
  type: AssessmentType;
  responses: Array<{
    questionId: string;
    response: string | number;
  }>;
  results: Array<{
    category: string;
    score: number;
    description: string;
  }>;
  completedAt: Date;
  valid: boolean;
}

export async function GET(req: NextRequest) {
  try {
    await connectToDatabase();
    
    // Get authenticated user
    const userData = await getUserFromRequest(req);
    if (!userData) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // First check the assessment status using the same logic as the status API
    // This ensures consistency between what's shown on the UI and what's checked here
    const allAssessmentTypes = [
      AssessmentType.PERSONALITY,
      AssessmentType.SKILLS,
      AssessmentType.INTERESTS,
      AssessmentType.APTITUDE
    ];

    // Get the valid/most recent assessments for each type
    const assessmentsByType: Record<AssessmentType, AssessmentWithResponses> = {} as Record<AssessmentType, AssessmentWithResponses>;
    
    for (const type of allAssessmentTypes) {
      const assessment = await Assessment.findOne({ 
        user: userData.id,
        type,
        valid: true 
      }).sort({ completedAt: -1 });
      
      if (assessment) {
        assessmentsByType[type] = assessment;
      }
    }
    
    // Check if all required assessments are completed
    const completedTypes = Object.keys(assessmentsByType) as AssessmentType[];
    const allAssessmentsCompleted = allAssessmentTypes.every(type => completedTypes.includes(type));
    
    if (!allAssessmentsCompleted) {
      // Return a 200 status with completion info instead of 400 error
      return NextResponse.json({ 
        completed: false,
        message: 'Not all required assessments are completed',
        completedAssessments: completedTypes,
        requiredAssessments: allAssessmentTypes
      });
    }

    // Format assessment data for AI analysis
    const assessmentData: AssessmentData[] = allAssessmentTypes.map(type => {
      const assessment = assessmentsByType[type];
      return {
        type,
        responses: assessment.responses.map((r: { questionId: string; response: string | number }) => ({
          questionId: r.questionId,
          response: r.response,
        })),
      };
    });

    // Get user info
    const user = await User.findById(userData.id);
    const userName = user?.name || user?.email || "Student";

    // Generate comprehensive analysis
    console.log('Generating comprehensive analysis for user:', userName);
    const analysis = await getAIAnalysis(assessmentData);
    
    return NextResponse.json({
      completed: true,
      username: userName,
      completedAssessments: completedTypes,
      analysisDate: new Date(),
      analysis,
    });
  } catch (error) {
    console.error('Error generating comprehensive results:', error);
    return NextResponse.json(
      { error: 'Failed to generate comprehensive results' },
      { status: 500 }
    );
  }
} 