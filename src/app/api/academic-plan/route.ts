import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import AcademicPlan from '@/models/AcademicPlan';
import Assessment, { AssessmentType } from '@/models/Assessment';

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

    // Check if all assessments are completed
    const requiredAssessmentTypes = [
      AssessmentType.PERSONALITY,
      AssessmentType.SKILLS,
      AssessmentType.INTERESTS,
      AssessmentType.APTITUDE
    ];

    const completedAssessments = await Assessment.find({
      user: userData.id,
      type: { $in: requiredAssessmentTypes },
      valid: true
    });

    const completedTypes = new Set(completedAssessments.map(a => a.type));
    const allAssessmentsCompleted = requiredAssessmentTypes.every(type => 
      completedTypes.has(type)
    );

    // Get user info
    const user = await User.findById(userData.id);
    
    // Find the user's academic plan if it exists
    const plan = await AcademicPlan.findOne({ userId: userData.id });
    
    console.log('Academic plan found:', plan ? 'Yes' : 'No');
    if (plan) {
      console.log('Academic plan structure:', {
        hasPlanProperty: !!plan.plan,
        planKeys: plan.plan ? Object.keys(plan.plan) : []
      });
    }
    
    const response = {
      plan: plan ? plan.plan : null,
      allAssessmentsCompleted,
      user: user ? { 
        name: user.name,
        grade: user.grade,
        email: user.email
      } : null
    };
    
    console.log('Sending response with plan:', !!response.plan);
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching academic plan:', error);
    return NextResponse.json(
      { error: 'Failed to fetch academic plan' },
      { status: 500 }
    );
  }
} 