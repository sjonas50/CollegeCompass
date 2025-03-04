import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import { getUserFromRequest } from '@/lib/auth';
import CourseTracker from '@/models/CourseTracker';
import { calculateAllGPAs } from '@/lib/gpa-calculator';

// GET: Retrieve course tracker data for the authenticated user
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
    
    // Find course tracker for the user
    let courseTracker = await CourseTracker.findOne({ userId: userData.id });
    
    // If no course tracker exists yet, create an empty one
    if (!courseTracker) {
      courseTracker = await CourseTracker.create({
        userId: userData.id,
        semesters: [],
        cumulativeGpa: 0,
        totalCredits: 0
      });
    }
    
    return NextResponse.json({
      courseTracker
    });
  } catch (error) {
    console.error('Error retrieving course tracker:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve course tracker' },
      { status: 500 }
    );
  }
}

// POST: Create or update course tracker
export async function POST(req: NextRequest) {
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
    
    // Get request body
    const { semesters } = await req.json();
    
    if (!semesters || !Array.isArray(semesters)) {
      return NextResponse.json(
        { error: 'Semesters data is required and must be an array' },
        { status: 400 }
      );
    }
    
    // Calculate GPAs
    const { semestersWithGPA, cumulativeGPA, totalCredits } = calculateAllGPAs(semesters);
    
    // Find and update or create course tracker
    const courseTracker = await CourseTracker.findOneAndUpdate(
      { userId: userData.id },
      {
        userId: userData.id,
        semesters: semestersWithGPA,
        cumulativeGpa: cumulativeGPA,
        totalCredits
      },
      { upsert: true, new: true }
    );
    
    return NextResponse.json({
      courseTracker,
      cumulativeGpa: cumulativeGPA,
      totalCredits
    });
  } catch (error) {
    console.error('Error updating course tracker:', error);
    return NextResponse.json(
      { error: 'Failed to update course tracker' },
      { status: 500 }
    );
  }
} 