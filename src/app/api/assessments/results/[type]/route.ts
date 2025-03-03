import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { AssessmentType, AssessmentResult } from '@/models/Assessment';
import Assessment from '@/models/Assessment';
import connectToDatabase from '@/lib/mongodb';

// Define interfaces for our results data
interface ResultItem {
  category: string;
  score: number;
  description: string;
}

interface RecommendationItem {
  field: string;
  description: string;
  courses: string[];
}

export async function GET(
  req: NextRequest,
  { params }: { params: { type: string } }
) {
  try {
    await connectToDatabase();
    
    // Verify user is authenticated
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const assessmentType = (await params).type as AssessmentType;

    // Validate assessment type
    if (!Object.values(AssessmentType).includes(assessmentType)) {
      return NextResponse.json(
        { error: 'Invalid assessment type' },
        { status: 400 }
      );
    }

    // Find the most recent completed assessment of the specified type
    const assessment = await Assessment.findOne({
      user: user.id,
      type: assessmentType,
      valid: true
    }).sort({ completedAt: -1 });

    if (!assessment) {
      return NextResponse.json(
        { error: 'No completed assessment found for this type' },
        { status: 404 }
      );
    }

    // Map the assessment results to a more client-friendly format
    const results = assessment.results.map((result: AssessmentResult): ResultItem => ({
      category: result.category,
      score: result.score,
      description: result.description
    }));

    // Sort results by score (descending)
    results.sort((a: ResultItem, b: ResultItem) => b.score - a.score);

    // Generate recommendations based on top results
    const recommendations = results.slice(0, 3).map((result: ResultItem): RecommendationItem => {
      // Generate some sample course recommendations based on the category
      let courses: string[] = [];
      if (result.category.toLowerCase().includes('science')) {
        courses = ['AP Biology', 'AP Chemistry', 'AP Physics', 'Computer Science'];
      } else if (result.category.toLowerCase().includes('business')) {
        courses = ['Economics', 'Business Studies', 'Statistics', 'Accounting'];
      } else if (result.category.toLowerCase().includes('art')) {
        courses = ['Studio Art', 'Art History', 'Design', 'Photography'];
      } else if (result.category.toLowerCase().includes('engineer')) {
        courses = ['Calculus', 'Physics', 'Computer Science', 'Engineering Design'];
      } else if (result.category.toLowerCase().includes('human')) {
        courses = ['AP Psychology', 'Sociology', 'Ethics', 'Philosophy'];
      } else {
        courses = ['Advanced Mathematics', 'English Literature', 'History', 'Foreign Language'];
      }
      
      return {
        field: result.category,
        description: result.description,
        courses: courses.slice(0, 4) // Limit to 4 courses
      };
    });

    return NextResponse.json({
      assessmentId: assessment._id,
      type: assessment.type,
      completedAt: assessment.completedAt,
      results,
      recommendations,
      overview: {
        topCategory: results[0]?.category || 'Unknown',
        assessmentDate: assessment.completedAt,
        totalQuestions: assessment.responses.length
      }
    });
  } catch (error) {
    console.error('Error fetching assessment results:', error);
    return NextResponse.json(
      { error: 'Failed to fetch assessment results' },
      { status: 500 }
    );
  }
} 