import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import Assessment, { AssessmentType } from '@/models/Assessment';
import { Document } from 'mongoose';

interface AssessmentDocument extends Document {
  type: AssessmentType;
  user: string;
  completedAt: Date;
  valid: boolean;
}

export async function GET(req: NextRequest) {
  try {
    // Authenticate user using existing JWT system
    const userData = await getUserFromRequest(req);
    if (!userData) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectToDatabase();
    
    // Get all assessments for the current user
    const userAssessments = await Assessment.find<AssessmentDocument>({ 
      user: userData.id,
      valid: true 
    }).sort({ completedAt: -1 });
    
    // Create status map for all assessment types
    const assessmentStatuses: Record<AssessmentType, string> = {} as Record<AssessmentType, string>;
    const assessmentTypes = Object.values(AssessmentType);
    
    // Initialize all types as "not_started"
    assessmentTypes.forEach(type => {
      assessmentStatuses[type] = "not_started";
    });
    
    // Update status based on user's assessments
    userAssessments.forEach((assessment: AssessmentDocument) => {
      if (assessmentStatuses[assessment.type] === "not_started") {
        assessmentStatuses[assessment.type] = "completed";
      }
    });
    
    return NextResponse.json({ 
      success: true,
      statuses: assessmentStatuses 
    });
    
  } catch (error) {
    console.error('Error getting assessment statuses:', error);
    return NextResponse.json(
      { message: 'Failed to get assessment statuses' },
      { status: 500 }
    );
  }
} 