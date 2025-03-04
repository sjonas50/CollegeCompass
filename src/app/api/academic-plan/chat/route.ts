import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import AcademicPlan from '@/models/AcademicPlan';
import { callClaude } from '@/lib/ai-services';

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

    // Parse the request body
    const body = await req.json();
    const { message } = body;
    
    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Get the user's academic plan
    const academicPlan = await AcademicPlan.findOne({ userId: userData.id });
    if (!academicPlan) {
      return NextResponse.json(
        { error: 'Academic plan not found. Please generate a plan first.' },
        { status: 404 }
      );
    }

    // Format the academic plan for the AI prompt
    const planData = JSON.stringify(academicPlan.plan, null, 2);
    
    // Generate a response using Claude
    const response = await generateChatResponse(message, planData);

    return NextResponse.json({
      response
    });
  } catch (error) {
    console.error('Error in academic plan chat:', error);
    return NextResponse.json(
      { error: 'Failed to process chat request' },
      { status: 500 }
    );
  }
}

async function generateChatResponse(userMessage: string, academicPlanData: string): Promise<string> {
  try {
    const prompt = `
You are an expert academic advisor who specializes in helping high school students understand and optimize their academic plans for college readiness. You have access to the student's current academic plan, which is provided below in JSON format.

The student is asking about their academic plan. Please provide a helpful, informative response to their question. Focus on explaining aspects of the plan, providing advice on course selections, suggesting modifications based on their interests, or explaining the reasoning behind certain recommendations.

Be conversational but professional, concise but informative. If the student asks about something not in the plan, you can suggest how they might modify their plan to accommodate their interests or goals.

THE STUDENT'S ACADEMIC PLAN:
${academicPlanData}

THE STUDENT'S QUESTION:
${userMessage}
`;

    const response = await callClaude({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      temperature: 0.7,
      system: "You are an expert academic advisor who helps high school students understand and optimize their academic plans for college readiness. Provide helpful, conversational responses to questions about their academic plan.",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    });

    // Safely access content
    let content = "I'm sorry, I'm having trouble processing your question right now. Please try again later.";
    if (response && 'content' in response && Array.isArray(response.content) && response.content.length > 0) {
      const firstContent = response.content[0];
      if (firstContent && typeof firstContent === 'object' && 'type' in firstContent && 
          firstContent.type === 'text' && 'text' in firstContent) {
        content = firstContent.text;
      }
    }

    return content;
  } catch (error) {
    console.error('Error generating chat response:', error);
    return "I'm sorry, I'm having trouble processing your question right now. Please try again later or contact your academic advisor for assistance.";
  }
} 