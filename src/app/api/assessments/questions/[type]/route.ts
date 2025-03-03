import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { AssessmentType, AssessmentQuestion } from '@/models/Assessment';
import connectToDatabase from '@/lib/mongodb';

// Store assessment questions in memory - in a real production app,
// these would likely be stored in the database
const personalityQuestions: AssessmentQuestion[] = [
  {
    id: 'p1',
    text: 'I enjoy being the center of attention at social gatherings.',
    type: 'scale',
    options: [
      { id: '1', text: 'Strongly Disagree', value: 1 },
      { id: '2', text: 'Disagree', value: 2 },
      { id: '3', text: 'Neutral', value: 3 },
      { id: '4', text: 'Agree', value: 4 },
      { id: '5', text: 'Strongly Agree', value: 5 },
    ],
  },
  {
    id: 'p2',
    text: 'I prefer to work on projects alone rather than in groups.',
    type: 'scale',
    options: [
      { id: '1', text: 'Strongly Disagree', value: 1 },
      { id: '2', text: 'Disagree', value: 2 },
      { id: '3', text: 'Neutral', value: 3 },
      { id: '4', text: 'Agree', value: 4 },
      { id: '5', text: 'Strongly Agree', value: 5 },
    ],
  },
  {
    id: 'p3',
    text: 'I often come up with creative solutions to problems.',
    type: 'scale',
    options: [
      { id: '1', text: 'Strongly Disagree', value: 1 },
      { id: '2', text: 'Disagree', value: 2 },
      { id: '3', text: 'Neutral', value: 3 },
      { id: '4', text: 'Agree', value: 4 },
      { id: '5', text: 'Strongly Agree', value: 5 },
    ],
  },
  {
    id: 'p4',
    text: 'I tend to plan activities in advance rather than act spontaneously.',
    type: 'scale',
    options: [
      { id: '1', text: 'Strongly Disagree', value: 1 },
      { id: '2', text: 'Disagree', value: 2 },
      { id: '3', text: 'Neutral', value: 3 },
      { id: '4', text: 'Agree', value: 4 },
      { id: '5', text: 'Strongly Agree', value: 5 },
    ],
  },
  {
    id: 'p5',
    text: 'I find it easy to empathize with people whose experiences are different from mine.',
    type: 'scale',
    options: [
      { id: '1', text: 'Strongly Disagree', value: 1 },
      { id: '2', text: 'Disagree', value: 2 },
      { id: '3', text: 'Neutral', value: 3 },
      { id: '4', text: 'Agree', value: 4 },
      { id: '5', text: 'Strongly Agree', value: 5 },
    ],
  },
];

const skillsQuestions: AssessmentQuestion[] = [
  {
    id: 's1',
    text: 'I am good at analyzing data and finding patterns.',
    type: 'scale',
    options: [
      { id: '1', text: 'Strongly Disagree', value: 1 },
      { id: '2', text: 'Disagree', value: 2 },
      { id: '3', text: 'Neutral', value: 3 },
      { id: '4', text: 'Agree', value: 4 },
      { id: '5', text: 'Strongly Agree', value: 5 },
    ],
  },
  {
    id: 's2',
    text: 'I can clearly explain complex concepts to others.',
    type: 'scale',
    options: [
      { id: '1', text: 'Strongly Disagree', value: 1 },
      { id: '2', text: 'Disagree', value: 2 },
      { id: '3', text: 'Neutral', value: 3 },
      { id: '4', text: 'Agree', value: 4 },
      { id: '5', text: 'Strongly Agree', value: 5 },
    ],
  },
  {
    id: 's3',
    text: 'Which of these activities do you excel at?',
    type: 'multiple_choice',
    options: [
      { id: 'a', text: 'Writing and communication', value: 'writing' },
      { id: 'b', text: 'Mathematical calculations', value: 'math' },
      { id: 'c', text: 'Artistic creation', value: 'art' },
      { id: 'd', text: 'Building or fixing things', value: 'mechanical' },
    ],
  },
];

const interestsQuestions: AssessmentQuestion[] = [
  {
    id: 'i1',
    text: 'I enjoy learning about scientific discoveries and theories.',
    type: 'scale',
    options: [
      { id: '1', text: 'Strongly Disagree', value: 1 },
      { id: '2', text: 'Disagree', value: 2 },
      { id: '3', text: 'Neutral', value: 3 },
      { id: '4', text: 'Agree', value: 4 },
      { id: '5', text: 'Strongly Agree', value: 5 },
    ],
  },
  {
    id: 'i2',
    text: 'I would prefer to spend a day:',
    type: 'multiple_choice',
    options: [
      { id: 'a', text: 'Reading literature or writing', value: 'humanities' },
      { id: 'b', text: 'Solving math problems or coding', value: 'stem' },
      { id: 'c', text: 'Creating art or music', value: 'arts' },
      { id: 'd', text: 'Learning about business or economics', value: 'business' },
    ],
  },
];

const aptitudeQuestions: AssessmentQuestion[] = [
  {
    id: 'a1',
    text: "If x + y = 10 and 2x - y = 5, what is the value of x?",
    type: 'multiple_choice',
    options: [
      { id: 'a', text: '3', value: 'a' },
      { id: 'b', text: '5', value: 'b' },
      { id: 'c', text: '7', value: 'c' },
      { id: 'd', text: '9', value: 'd' },
    ],
  },
  {
    id: 'a2',
    text: "In a paragraph, explain how you would approach solving a complex problem.",
    type: 'open_ended',
  },
];

const assessmentQuestions: Record<AssessmentType, AssessmentQuestion[]> = {
  [AssessmentType.PERSONALITY]: personalityQuestions,
  [AssessmentType.SKILLS]: skillsQuestions,
  [AssessmentType.INTERESTS]: interestsQuestions,
  [AssessmentType.APTITUDE]: aptitudeQuestions,
};

export async function GET(
  req: NextRequest,
  { params }: { params: { type: string } }
) {
  try {
    await connectToDatabase();
    
    // Verify user is authenticated
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { message: 'Authentication required' },
        { status: 401 }
      );
    }

    const type = (await params).type as AssessmentType;
    
    // Validate assessment type
    if (!Object.values(AssessmentType).includes(type)) {
      return NextResponse.json(
        { message: 'Invalid assessment type' },
        { status: 400 }
      );
    }

    // Get questions for the requested assessment type
    const questions = assessmentQuestions[type];

    return NextResponse.json({
      type,
      questions,
      title: `${type.charAt(0).toUpperCase() + type.slice(1)} Assessment`,
      description: getAssessmentDescription(type),
    });
  } catch (error) {
    console.error('Error fetching assessment questions:', error);
    return NextResponse.json(
      { message: 'An error occurred while fetching assessment questions' },
      { status: 500 }
    );
  }
}

function getAssessmentDescription(type: AssessmentType): string {
  switch (type) {
    case AssessmentType.PERSONALITY:
      return 'This assessment will help us understand your personality traits and how they relate to potential fields of study and career paths.';
    case AssessmentType.SKILLS:
      return 'This assessment will identify your strongest skills and abilities to match you with fields where you can excel.';
    case AssessmentType.INTERESTS:
      return 'This assessment will explore your academic and career interests to find fields that will keep you engaged and motivated.';
    case AssessmentType.APTITUDE:
      return 'This assessment will measure your natural abilities and potential for success in different fields of study.';
    default:
      return '';
  }
} 