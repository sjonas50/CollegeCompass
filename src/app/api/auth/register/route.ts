import { NextRequest, NextResponse } from 'next/server';
import User from '@/models/User';
import connectToDatabase from '@/lib/mongodb';

export async function POST(req: NextRequest) {
  try {
    // Connect to database
    await connectToDatabase();

    // Parse request body
    const { name, email, password, grade, role } = await req.json();

    // Validate required fields
    if (!name || !email || !password) {
      return NextResponse.json(
        { message: 'Name, email, and password are required' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return NextResponse.json(
        { message: 'Email already registered' },
        { status: 409 }
      );
    }

    // Validate password strength
    if (password.length < 8) {
      return NextResponse.json(
        { message: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    // Validate role
    const validRoles = ['student', 'parent', 'counselor', 'admin'];
    if (role && !validRoles.includes(role)) {
      return NextResponse.json(
        { message: 'Invalid role' },
        { status: 400 }
      );
    }

    // Validate grade if student
    if (role === 'student') {
      if (!grade || grade < 9 || grade > 12) {
        return NextResponse.json(
          { message: 'Valid grade (9-12) is required for students' },
          { status: 400 }
        );
      }
    }

    // Create new user
    const newUser = new User({
      name,
      email: email.toLowerCase(),
      password,
      role: role || 'student',
      grade: role === 'student' ? grade : undefined,
    });

    // Save user to database (password will be hashed by pre-save hook)
    await newUser.save();

    // Return success response (excluding password)
    return NextResponse.json(
      {
        message: 'User registered successfully',
        user: {
          id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
          grade: newUser.grade,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { message: 'An error occurred during registration' },
      { status: 500 }
    );
  }
} 