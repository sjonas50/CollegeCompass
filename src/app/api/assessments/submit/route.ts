import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { AssessmentType } from '@/models/Assessment';
import Assessment from '@/models/Assessment';
import User from '@/models/User';
import connectToDatabase from '@/lib/mongodb';
import { processAssessmentResponses } from '@/lib/ai-services';

// Define the shape of the response we expect from the client
interface AssessmentSubmission {
  questionId: string;
  questionText: string;
  response: string | number;
}

export async function POST(req: NextRequest) {
  try {
    await connectToDatabase();
    
    // Verify user is authenticated
    const userData = await getUserFromRequest(req);
    if (!userData) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Parse request body
    const { type, responses } = await req.json();

    // Validate request
    if (!type || !Object.values(AssessmentType).includes(type)) {
      return NextResponse.json(
        { error: 'Valid assessment type is required' },
        { status: 400 }
      );
    }

    if (!responses || !Array.isArray(responses) || responses.length === 0) {
      return NextResponse.json(
        { error: 'Assessment responses are required' },
        { status: 400 }
      );
    }

    // Format responses for AI processing
    const formattedResponses = responses.map((response: AssessmentSubmission) => ({
      questionId: response.questionId,
      questionText: response.questionText,
      response: response.response,
      assessmentType: type,
    }));

    // Process responses using AI
    const recommendations = await processAssessmentResponses(formattedResponses);

    // Create or update the assessment in the database
    const assessment = new Assessment({
      user: userData.id,
      type,
      responses: responses.map((response: AssessmentSubmission) => ({
        questionId: response.questionId,
        response: response.response,
      })),
      results: recommendations.map(rec => ({
        category: rec.fieldOfStudy,
        score: rec.confidenceScore * 100, // Convert 0-1 to 0-100
        description: rec.description,
      })),
      valid: true,
    });

    // Save the assessment
    await assessment.save();

    // Add assessment to user's assessmentResponses array
    await User.findByIdAndUpdate(
      userData.id,
      { $push: { assessmentResponses: assessment._id } },
      { new: true }
    );

    return NextResponse.json({
      message: 'Assessment submitted successfully',
      assessmentId: assessment._id,
      // Return limited results for immediate display
      summary: {
        type,
        completedAt: assessment.completedAt,
        topResults: recommendations.slice(0, 3),
      }
    });
  } catch (error) {
    console.error('Error submitting assessment:', error);
    return NextResponse.json(
      { error: 'Failed to submit assessment' },
      { status: 500 }
    );
  }
} 