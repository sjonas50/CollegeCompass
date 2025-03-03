import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { AssessmentType, AssessmentResult } from '@/models/Assessment';
import Assessment from '@/models/Assessment';
import connectToDatabase from '@/lib/mongodb';

interface AggregatedResult {
  category: string;
  score: number;
  count: number;
}

export async function GET(req: NextRequest) {
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

    // Get all valid assessments for this user
    const userAssessments = await Assessment.find({
      user: user.id,
      valid: true,
    }).sort({ completedAt: -1 });

    // If no assessments found, return empty response
    if (!userAssessments || userAssessments.length === 0) {
      return NextResponse.json({
        recommendedFields: [],
        totalAssessments: Object.values(AssessmentType).length,
        completedAssessments: 0,
        upcomingDeadlines: [],
      });
    }

    // Count unique completed assessment types
    const completedAssessmentTypes = new Set<string>();
    userAssessments.forEach(assessment => {
      completedAssessmentTypes.add(assessment.type);
    });

    // Get all results from all assessments and aggregate them
    const allResults: AggregatedResult[] = [];
    
    userAssessments.forEach(assessment => {
      if (assessment.results && assessment.results.length > 0) {
        assessment.results.forEach((result: AssessmentResult) => {
          const existingResult = allResults.find(r => r.category === result.category);
          if (existingResult) {
            // Update existing result
            existingResult.score += result.score;
            existingResult.count += 1;
          } else {
            // Add new result
            allResults.push({
              category: result.category,
              score: result.score,
              count: 1,
            });
          }
        });
      }
    });

    // Calculate average scores and sort by highest score
    const aggregatedResults = allResults
      .map(result => ({
        field: result.category,
        averageScore: result.score / result.count,
      }))
      .sort((a, b) => b.averageScore - a.averageScore);

    // Get the top 5 recommended fields
    const recommendedFields = aggregatedResults.slice(0, 5).map(result => result.field);

    return NextResponse.json({
      recommendedFields,
      totalAssessments: Object.values(AssessmentType).length,
      completedAssessments: completedAssessmentTypes.size,
      // Include upcoming deadlines as a mock - in a real implementation this would be calculated
      upcomingDeadlines: [
        {
          id: '1',
          title: 'Complete Interests Assessment',
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days from now
          type: 'assessment',
        },
        {
          id: '2',
          title: 'Update Academic Plan',
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 14 days from now
          type: 'academic',
        }
      ],
    });
  } catch (error) {
    console.error('Error fetching dashboard recommendations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard recommendations' },
      { status: 500 }
    );
  }
} 