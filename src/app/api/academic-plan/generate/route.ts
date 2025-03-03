import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';
import Assessment, { AssessmentType } from '@/models/Assessment';
import AcademicPlan, { AcademicPlanData, CourseRecommendation } from '@/models/AcademicPlan';
import Anthropic from '@anthropic-ai/sdk';

// Define the assessment data interface expected by the AI service
interface AssessmentData {
  type: AssessmentType;
  responses: Array<{
    questionId: string;
    response: string | number;
  }>;
}

// Define types for the populated assessment document
interface AssessmentDocument {
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

    // Check if all assessments are completed
    const requiredAssessmentTypes = [
      AssessmentType.PERSONALITY,
      AssessmentType.SKILLS,
      AssessmentType.INTERESTS,
      AssessmentType.APTITUDE
    ];

    // Get the valid/most recent assessments for each type
    const assessmentsByType: Record<AssessmentType, AssessmentDocument> = {} as Record<AssessmentType, AssessmentDocument>;
    
    for (const type of requiredAssessmentTypes) {
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
    const allAssessmentsCompleted = requiredAssessmentTypes.every(type => 
      completedTypes.includes(type)
    );
    
    if (!allAssessmentsCompleted) {
      console.log('Missing assessments:', requiredAssessmentTypes.filter(type => !completedTypes.includes(type)));
      return NextResponse.json(
        { error: 'All assessments must be completed before generating an academic plan' },
        { status: 400 }
      );
    }

    // Get user info for context
    const user = await User.findById(userData.id);
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }
    
    console.log('Generating academic plan for user:', userData.id, 'Grade:', user.grade);

    // Format assessment data for AI
    const assessmentData: AssessmentData[] = requiredAssessmentTypes.map(type => {
      const assessment = assessmentsByType[type];
      return {
        type,
        responses: assessment.responses.map((r: { questionId: string; response: string | number }) => ({
          questionId: r.questionId,
          response: r.response,
        })),
      };
    });

    try {
      // Generate the academic plan
      console.log('Starting academic plan generation');
      const academicPlan = await generateAcademicPlan(assessmentData, user.grade);
      console.log('Academic plan generation completed');

      // Save or update the academic plan in the database
      await AcademicPlan.findOneAndUpdate(
        { userId: userData.id },
        { 
          userId: userData.id,
          plan: academicPlan 
        },
        { upsert: true, new: true }
      );
      console.log('Academic plan saved to database');

      return NextResponse.json({
        success: true,
        message: 'Academic plan generated successfully'
      });
    } catch (generationError: Error | unknown) {
      const errorMessage = generationError instanceof Error ? generationError.message : 'Unknown error in generation process';
      console.error('Error in academic plan generation process:', generationError);
      
      // Try using the fallback plan as a last resort
      try {
        console.log('Attempting to use fallback academic plan');
        const fallbackPlan = getFallbackAcademicPlan(user.grade);
        
        // Save fallback plan to database
        await AcademicPlan.findOneAndUpdate(
          { userId: userData.id },
          { 
            userId: userData.id,
            plan: fallbackPlan 
          },
          { upsert: true, new: true }
        );
        
        console.log('Fallback academic plan saved to database');
        
        return NextResponse.json({
          success: true,
          message: 'Academic plan generated using fallback data',
          warning: 'Used fallback data due to AI generation error'
        });
      } catch (fallbackError: Error | unknown) {
        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown fallback error';
        console.error('Fallback plan generation failed:', fallbackError);
        return NextResponse.json(
          { 
            error: 'Failed to generate academic plan',
            message: errorMessage,
            fallbackError: fallbackErrorMessage
          },
          { status: 500 }
        );
      }
    }
  } catch (error: Error | unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
    console.error('Error in academic plan generation API:', error);
    return NextResponse.json(
      { 
        error: 'Failed to generate academic plan',
        message: errorMessage
      },
      { status: 500 }
    );
  }
}

async function generateAcademicPlan(assessmentData: AssessmentData[], grade: number): Promise<AcademicPlanData> {
  // Ensure grade is within valid range for high school
  const validGrade = Math.min(Math.max(9, grade), 12);
  
  // Format the assessment data into a string for the prompt
  const formattedData = assessmentData.map(assessment => {
    return `${assessment.type.toUpperCase()} ASSESSMENT:\n${assessment.responses.map((r, i) => {
      // Simulate question text from questionId if needed
      const questionText = `Question about ${r.questionId.replace(/-/g, ' ')}`;
      return `Question ${i+1}: ${questionText}\nAnswer: ${r.response}`;
    }).join('\n\n')}`;
  }).join('\n\n---\n\n');
  
  // Create a prompt for the academic plan
  const prompt = `
You are a specialized academic advisor with expertise in creating 4-year high school academic plans that prepare students for college and career success. Based on the assessment data below, create a DETAILED and PERSONALIZED academic plan.

The student is currently in grade ${validGrade}.

IMPORTANT: Your response MUST be valid JSON format WITHOUT any comments, explanations, or non-JSON text. The JSON MUST include ALL fields in the structure shown below.

{
  "focusAreas": [
    "Focus Area 1",
    "Focus Area 2",
    "Focus Area 3",
    "Focus Area 4",
    "Focus Area 5"
  ],
  "careerAlignment": [
    "Career Path 1",
    "Career Path 2",
    "Career Path 3",
    "Career Path 4",
    "Career Path 5"
  ],
  "fourYearPlan": {
    "freshman": [
      {
        "name": "Course name",
        "description": "Brief description of the course",
        "type": "required",
        "year": 9,
        "semester": "Fall",
        "credits": 1,
        "prerequisites": []
      }
    ],
    "sophomore": [],
    "junior": [],
    "senior": []
  },
  "extracurricularRecommendations": [
    "Activity 1",
    "Activity 2"
  ],
  "summerActivities": [
    "Summer Activity 1",
    "Summer Activity 2"
  ],
  "postGraduationRecommendations": [
    "Recommendation 1",
    "Recommendation 2"
  ]
}

Notes on the structure:
1. focusAreas: Include 3-5 specific academic areas the student should focus on
2. careerAlignment: Include 3-5 specific career paths that align with assessments
3. fourYearPlan: Each year should include 6-8 courses
4. For each course: 
   - "type" must be exactly one of: "required", "elective", or "advanced"
   - "year" must be exactly one of: 9, 10, 11, or 12
   - "semester" must be exactly one of: "Fall", "Spring", or "Both"
5. extracurricularRecommendations: Include 5-7 specific activities
6. summerActivities: Include 3-5 specific summer activities
7. postGraduationRecommendations: Include 3-5 specific recommendations

ASSESSMENT DATA:
${formattedData}
`;

  try {
    console.log('Initializing Anthropic client for academic plan generation');
    // Initialize Anthropic client
    const anthropic = new Anthropic();
    
    console.log('Sending request to Anthropic API');
    // Generate academic plan with Claude
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8000,
      temperature: 0.7,
      system: `You are an expert academic advisor who creates detailed, personalized 4-year high school academic plans.

EXTREMELY IMPORTANT: Your responses must be in valid JSON format ONLY. Do not include ANY comments, explanations, or non-JSON text.

The JSON structure must follow the exact schema provided, with all fields included:
- focusAreas: array of strings
- careerAlignment: array of strings
- fourYearPlan: object with freshman, sophomore, junior, senior arrays, each containing course objects
- Each course object must have: name, description, type, year, semester, credits, prerequisites
- type must be exactly: "required", "elective", or "advanced"
- year must be exactly: 9, 10, 11, or 12
- semester must be exactly: "Fall", "Spring", or "Both"
- extracurricularRecommendations: array of strings
- summerActivities: array of strings
- postGraduationRecommendations: array of strings`,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    });

    console.log('Received response from Anthropic API');
    console.log(`Response length: ${JSON.stringify(response).length} characters`);
    
    // Extract and parse the JSON
    if (!response.content || response.content.length === 0) {
      console.error('Empty response from Anthropic API');
      throw new Error('Empty response from AI service');
    }
    
    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    
    if (!content) {
      console.error('No text content in Anthropic API response');
      throw new Error('No text content in AI response');
    }
    
    console.log(`Response content length: ${content.length} characters`);
    console.log('Parsing JSON from AI response');
    
    // Extract JSON from the response
    try {
      // Try to parse the entire response as JSON first
      console.log('Attempting to parse complete response as JSON');
      const parsedData = JSON.parse(content) as AcademicPlanData;
      
      // Validate the parsed data has the expected structure
      if (!parsedData.focusAreas || !parsedData.careerAlignment || !parsedData.fourYearPlan) {
        console.error('Parsed data missing required fields', JSON.stringify(parsedData, null, 2));
        throw new Error('Invalid academic plan structure from AI response');
      }
      
      // Check if the fourYearPlan has all required years
      const years = ['freshman', 'sophomore', 'junior', 'senior'];
      const missingYears = years.filter(year => !parsedData.fourYearPlan[year as keyof typeof parsedData.fourYearPlan]);
      
      if (missingYears.length > 0) {
        console.error(`Missing years in four year plan: ${missingYears.join(', ')}`);
        throw new Error(`Four year plan missing required years: ${missingYears.join(', ')}`);
      }
      
      // Log successful parsing
      console.log('Successfully parsed academic plan data');
      
      return parsedData;
    } catch (parseError) {
      console.error('Error parsing JSON response:', parseError);
      
      // Log more details about the content
      console.log('Content type:', typeof content);
      console.log('Content length:', content.length);
      console.log('First 500 characters of response:', content.substring(0, 500));
      console.log('Last 500 characters of response:', content.substring(content.length - 500));
      
      // Check if there might be extra text before or after the JSON
      const trimmedContent = content.trim();
      const firstChar = trimmedContent.charAt(0);
      const lastChar = trimmedContent.charAt(trimmedContent.length - 1);
      
      if (firstChar !== '{' || lastChar !== '}') {
        console.log('Content appears to have non-JSON text before or after the JSON object');
        console.log('First character:', firstChar, 'Last character:', lastChar);
      }
      
      // If that fails, try to extract JSON using regex
      console.log('Attempting to extract JSON using regex');
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          console.log('Found potential JSON match with regex');
          const jsonString = jsonMatch[0];
          console.log('JSON string length:', jsonString.length);
          
          // Try to parse the extracted JSON
          const extractedJson = JSON.parse(jsonString) as AcademicPlanData;
          
          // Validate the extracted JSON has all required fields
          const requiredFields = ['focusAreas', 'careerAlignment', 'fourYearPlan', 
                                  'extracurricularRecommendations', 'summerActivities', 
                                  'postGraduationRecommendations'];
          
          const missingFields = requiredFields.filter(field => !extractedJson[field as keyof AcademicPlanData]);
          
          if (missingFields.length > 0) {
            console.error('Extracted JSON missing required fields:', missingFields.join(', '));
            console.error('Extracted JSON structure:', JSON.stringify(extractedJson, null, 2));
            throw new Error(`Invalid academic plan structure: missing ${missingFields.join(', ')}`);
          }
          
          // Check if the fourYearPlan has all required years
          if (extractedJson.fourYearPlan) {
            const years = ['freshman', 'sophomore', 'junior', 'senior'];
            const missingYears = years.filter(year => 
              !extractedJson.fourYearPlan[year as keyof typeof extractedJson.fourYearPlan]);
            
            if (missingYears.length > 0) {
              console.error(`Missing years in extracted four year plan: ${missingYears.join(', ')}`);
              throw new Error(`Four year plan missing required years: ${missingYears.join(', ')}`);
            }
          }
          
          console.log('Successfully extracted and validated JSON with regex');
          return extractedJson;
        } catch (extractError) {
          console.error('Error parsing extracted JSON:', extractError);
          console.log('Extracted JSON portion:', jsonMatch[0].substring(0, 200) + '...');
          throw new Error('Failed to parse JSON from AI response after extraction attempt');
        }
      }
      
      // If we still can't parse JSON, try a more aggressive cleanup
      console.log('No valid JSON found with regex, attempting aggressive cleanup');
      try {
        // Remove all non-JSON syntax like comments and trailing commas
        const cleanedContent = content
          .replace(/\/\/.*?(\r?\n|$)/g, '') // Remove single line comments
          .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
          .replace(/,(\s*[}\]])/g, '$1')    // Remove trailing commas
          .replace(/([{,])\s*\/\/.*?(\r?\n|$)/g, '$1') // Remove comments after opening braces or commas
          .trim();
        
        console.log('Cleaned content length:', cleanedContent.length);
        const cleanedJson = JSON.parse(cleanedContent) as AcademicPlanData;
        console.log('Successfully parsed JSON after aggressive cleanup');
        
        return cleanedJson;
      } catch (cleanupError) {
        console.error('Error parsing cleaned JSON:', cleanupError);
        throw new Error('Failed to parse academic plan from AI response after all cleanup attempts');
      }
    }
  } catch (error) {
    console.error('Error generating academic plan with AI:', error);
    
    // Return a fallback academic plan
    console.log('Using fallback academic plan');
    return getFallbackAcademicPlan(validGrade);
  }
}

function getFallbackAcademicPlan(grade: number): AcademicPlanData {
  // Customize some elements based on the student's grade
  const currentYear = grade;
  const yearLabels = ["freshman", "sophomore", "junior", "senior"];
  
  // Determine which year the student is currently in
  const currentYearLabel = yearLabels[Math.min(Math.max(0, currentYear - 9), 3)];
  
  return {
    focusAreas: [
      "Mathematics and Quantitative Skills",
      "Communication and Writing",
      "Critical Thinking and Problem Solving",
      "Technology and Digital Literacy",
      "Interpersonal Skills and Collaboration"
    ],
    careerAlignment: [
      "Computer Science/Software Development",
      "Business Administration/Management",
      "Engineering",
      "Healthcare/Medicine",
      "Education/Teaching"
    ],
    fourYearPlan: {
      freshman: getDefaultCoursesForYear(9),
      sophomore: getDefaultCoursesForYear(10),
      junior: getDefaultCoursesForYear(11),
      senior: getDefaultCoursesForYear(12)
    },
    extracurricularRecommendations: [
      "Student Government or Leadership Club",
      "Academic Competition Team (Debate, Math, Science Olympiad)",
      "Community Service Organization",
      "Sports Team or Athletic Club",
      "Arts Program (Music, Theater, Visual Arts)",
      "Career-Oriented Club (Business, Engineering, Health)"
    ],
    summerActivities: [
      `Summer courses at local community college (focus on ${currentYearLabel} preparation)`,
      "Volunteer work in areas aligned with career interests",
      "Summer internship or job shadowing",
      "Academic enrichment program or camp",
      "Self-directed project or portfolio development"
    ],
    postGraduationRecommendations: [
      "Apply to 4-year colleges with strong programs in areas of interest",
      "Consider gap year opportunities for skill development",
      "Explore internship possibilities in chosen career fields",
      "Research scholarship opportunities based on academic achievements",
      "Develop a backup plan including community college pathway options"
    ]
  };
}

// Helper function to generate default courses for each year
function getDefaultCoursesForYear(year: 9 | 10 | 11 | 12): CourseRecommendation[] {
  const coursesByYear: Record<9 | 10 | 11 | 12, CourseRecommendation[]> = {
    9: [
      {
        name: "English 9",
        description: "Foundational English course covering literature, writing, and communication skills",
        type: "required",
        year: 9,
        semester: "Fall",
        credits: 1,
        prerequisites: []
      },
      {
        name: "Algebra I or Geometry",
        description: "Core mathematics course focusing on algebraic concepts or geometric principles",
        type: "required",
        year: 9,
        semester: "Both",
        credits: 1,
        prerequisites: []
      },
      {
        name: "Biology",
        description: "Introduction to biological concepts and scientific methods",
        type: "required",
        year: 9,
        semester: "Both",
        credits: 1,
        prerequisites: []
      },
      {
        name: "World History",
        description: "Survey of major historical developments across global civilizations",
        type: "required",
        year: 9,
        semester: "Both",
        credits: 1,
        prerequisites: []
      },
      {
        name: "Physical Education",
        description: "Development of physical fitness, health, and team sports skills",
        type: "required",
        year: 9,
        semester: "Both",
        credits: 0.5,
        prerequisites: []
      },
      {
        name: "Foreign Language I",
        description: "Introduction to a foreign language and its associated cultures",
        type: "elective",
        year: 9,
        semester: "Both",
        credits: 1,
        prerequisites: []
      }
    ],
    10: [
      {
        name: "English 10",
        description: "Continued development of literary analysis and composition skills",
        type: "required",
        year: 10,
        semester: "Fall",
        credits: 1,
        prerequisites: ["English 9"]
      },
      {
        name: "Geometry or Algebra II",
        description: "Advanced mathematical concepts building on previous coursework",
        type: "required",
        year: 10,
        semester: "Both",
        credits: 1,
        prerequisites: ["Algebra I"]
      },
      {
        name: "Chemistry",
        description: "Study of matter, its properties, and the interactions between substances",
        type: "required",
        year: 10,
        semester: "Both",
        credits: 1,
        prerequisites: ["Biology"]
      },
      {
        name: "U.S. History",
        description: "Comprehensive study of American history and its impact on modern society",
        type: "required",
        year: 10,
        semester: "Both",
        credits: 1,
        prerequisites: []
      },
      {
        name: "Foreign Language II",
        description: "Continued study of foreign language with emphasis on conversation and composition",
        type: "elective",
        year: 10,
        semester: "Both",
        credits: 1,
        prerequisites: ["Foreign Language I"]
      },
      {
        name: "Fine Arts Elective",
        description: "Introduction to artistic expression through various media",
        type: "elective",
        year: 10,
        semester: "Both",
        credits: 0.5,
        prerequisites: []
      }
    ],
    11: [
      {
        name: "English 11/American Literature",
        description: "Study of American literature and advanced composition techniques",
        type: "required",
        year: 11,
        semester: "Fall",
        credits: 1,
        prerequisites: ["English 10"]
      },
      {
        name: "Algebra II or Pre-Calculus",
        description: "Advanced algebra concepts or preparation for calculus",
        type: "required",
        year: 11,
        semester: "Both",
        credits: 1,
        prerequisites: ["Geometry"]
      },
      {
        name: "Physics",
        description: "Study of matter, energy, and the fundamental forces of nature",
        type: "required",
        year: 11,
        semester: "Both",
        credits: 1,
        prerequisites: ["Chemistry"]
      },
      {
        name: "Government/Civics",
        description: "Examination of government structures, civic responsibilities, and political systems",
        type: "required",
        year: 11,
        semester: "Fall",
        credits: 0.5,
        prerequisites: []
      },
      {
        name: "Economics",
        description: "Introduction to economic principles and financial literacy",
        type: "required",
        year: 11,
        semester: "Spring",
        credits: 0.5,
        prerequisites: []
      },
      {
        name: "Foreign Language III",
        description: "Advanced language study focusing on literature and cultural contexts",
        type: "advanced",
        year: 11,
        semester: "Both",
        credits: 1,
        prerequisites: ["Foreign Language II"]
      },
      {
        name: "Career Pathway Elective",
        description: "Specialized course aligned with student's career interests",
        type: "elective",
        year: 11,
        semester: "Both",
        credits: 1,
        prerequisites: []
      }
    ],
    12: [
      {
        name: "English 12/British Literature",
        description: "Study of British literature and college-level writing skills",
        type: "required",
        year: 12,
        semester: "Fall",
        credits: 1,
        prerequisites: ["English 11"]
      },
      {
        name: "Pre-Calculus or Calculus",
        description: "Advanced mathematics preparation for college-level work",
        type: "advanced",
        year: 12,
        semester: "Both",
        credits: 1,
        prerequisites: ["Algebra II"]
      },
      {
        name: "Advanced Science Elective",
        description: "Specialized science course in an area of interest",
        type: "advanced",
        year: 12,
        semester: "Both",
        credits: 1,
        prerequisites: ["Physics"]
      },
      {
        name: "Social Studies Elective",
        description: "Specialized social studies course based on student interests",
        type: "elective",
        year: 12,
        semester: "Both",
        credits: 1,
        prerequisites: []
      },
      {
        name: "College Preparation Seminar",
        description: "Guidance on college applications, essays, and transition planning",
        type: "required",
        year: 12,
        semester: "Fall",
        credits: 0.5,
        prerequisites: []
      },
      {
        name: "Senior Capstone Project",
        description: "Independent research or project demonstrating culmination of high school learning",
        type: "required",
        year: 12,
        semester: "Spring",
        credits: 0.5,
        prerequisites: []
      },
      {
        name: "Career Pathway Advanced Elective",
        description: "Advanced course aligned with post-graduation plans",
        type: "advanced",
        year: 12,
        semester: "Both",
        credits: 1,
        prerequisites: []
      }
    ]
  };
  
  return coursesByYear[year] || [];
} 