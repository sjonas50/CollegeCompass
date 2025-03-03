import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// Define assessment types
export enum AssessmentType {
  PERSONALITY = 'personality',
  SKILLS = 'skills',
  INTERESTS = 'interests',
  APTITUDE = 'aptitude',
}

// Define assessment response interface
export interface AssessmentResponse {
  questionId: string;
  questionText: string;
  response: string | number;
  assessmentType: AssessmentType;
}

// Define types for career paths and analysis results
interface CareerPath {
  title: string;
  description: string;
  educationRequirements: string[];
  majorRecommendations: string[];
}

interface AIAnalysisResult {
  careerPaths: CareerPath[];
  strengths: string[];
  improvementAreas: string[];
  recommendedSteps: string[];
}

// Interface for the response from the AI
export interface AIRecommendation {
  fieldOfStudy: string;
  description: string;
  careerPaths: string[];
  coursesRecommended: string[];
  strengthsHighlighted: string[];
  areasForGrowth: string[];
  confidenceScore: number; // 0-1 score representing confidence in the recommendation
}

// Configure AI clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// Mapping of assessment types to their descriptions
export const ASSESSMENT_DESCRIPTIONS = {
  [AssessmentType.INTERESTS]: "Interest assessment that identifies academic and career preferences.",
  [AssessmentType.PERSONALITY]: "Personality assessment that helps understand how traits influence educational paths.",
  [AssessmentType.SKILLS]: "Skills assessment that identifies technical and soft skill proficiencies.",
  [AssessmentType.APTITUDE]: "Aptitude assessment that evaluates inherent abilities and potential in different fields of study."
};

/**
 * Process assessment responses with OpenAI
 */
async function processWithOpenAI(responses: AssessmentResponse[]): Promise<AIRecommendation[]> {
  const assessmentType = responses[0]?.assessmentType;
  
  if (!assessmentType) {
    throw new Error('Assessment type is required');
  }
  
  // Create a structured representation of the responses for the AI
  const formattedResponses = responses.map(r => ({
    question: r.questionText,
    answer: r.response
  }));
  
  const prompt = `
    You are a college counselor AI that provides personalized academic recommendations based on student assessments.
    
    You have received responses from a ${ASSESSMENT_DESCRIPTIONS[assessmentType]}.
    
    The student's responses:
    ${JSON.stringify(formattedResponses, null, 2)}
    
    Based on these responses, provide the top 3 recommended fields of study along with supporting information.
    Format your response as a JSON array containing objects with these properties:
    - fieldOfStudy: The recommended field
    - description: A paragraph explaining why this is a good match for the student
    - careerPaths: An array of 4-6 potential career paths within this field
    - coursesRecommended: An array of 4-6 high school courses that would prepare the student for this field
    - strengthsHighlighted: An array of 3-4 strengths the student demonstrated in their responses
    - areasForGrowth: An array of 2-3 areas the student might want to develop further
    - confidenceScore: A number between 0 and 1 indicating your confidence in this recommendation
    
    Ensure all fields are present and your response is a valid JSON array.
  `;
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a college counselor AI that analyzes student assessment responses and provides accurate educational recommendations."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    
    const responseText = completion.choices[0].message.content || '{"recommendations": []}';
    const parsedResponse = JSON.parse(responseText);
    
    // Handle both formats that might be returned (direct array or nested in recommendations property)
    return Array.isArray(parsedResponse) ? parsedResponse : 
           (parsedResponse.recommendations || []);
  } catch (error) {
    console.error('Error processing with OpenAI:', error);
    throw error;
  }
}

/**
 * Process assessment responses with Anthropic Claude
 */
async function processWithClaude(responses: AssessmentResponse[]): Promise<AIRecommendation[]> {
  const assessmentType = responses[0]?.assessmentType;
  
  if (!assessmentType) {
    throw new Error('Assessment type is required');
  }
  
  // Create a structured representation of the responses for the AI
  const formattedResponses = responses.map(r => ({
    question: r.questionText,
    answer: r.response
  }));
  
  const prompt = `
    You are a college counselor AI that provides personalized academic recommendations based on student assessments.
    
    You have received responses from a ${ASSESSMENT_DESCRIPTIONS[assessmentType]}.
    
    The student's responses:
    ${JSON.stringify(formattedResponses, null, 2)}
    
    Based on these responses, provide the top 3 recommended fields of study along with supporting information.
    Format your response as a JSON array containing objects with these properties:
    - fieldOfStudy: The recommended field
    - description: A paragraph explaining why this is a good match for the student
    - careerPaths: An array of 4-6 potential career paths within this field
    - coursesRecommended: An array of 4-6 high school courses that would prepare the student for this field
    - strengthsHighlighted: An array of 3-4 strengths the student demonstrated in their responses
    - areasForGrowth: An array of 2-3 areas the student might want to develop further
    - confidenceScore: A number between 0 and 1 indicating your confidence in this recommendation
    
    Ensure all fields are present and your response is a valid JSON array.
  `;
  
  try {
    const anthropicResponse = await anthropic.messages.create({
      model: "claude-3-7-sonnet-20250219",
      max_tokens: 2500,
      temperature: 0.7,
      system: "You are an educational guidance counselor helping a high school student understand their assessment results.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt
            }
          ]
        }
      ]
    });
    
    // Extract and parse the JSON response
    const responseContent = anthropicResponse.content[0];
    let responseText = '';
    
    if (responseContent.type === 'text') {
      responseText = responseContent.text;
    }
    
    // Find the JSON array in the response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    
    if (!jsonMatch) {
      throw new Error('Invalid response format from Claude');
    }
    
    return JSON.parse(jsonMatch[0]) as AIRecommendation[];
  } catch (error) {
    console.error('Error processing with Claude:', error);
    throw error;
  }
}

/**
 * Generate a comprehensive analysis from all assessment data
 */
export async function getAIAnalysis(assessmentData: Array<{
  type: AssessmentType;
  responses: Array<{
    questionId: string;
    response: string | number;
  }>;
}>): Promise<AIAnalysisResult> {
  // Choose the AI service based on configuration or availability
  let useOpenAI = process.env.AI_SERVICE === 'openai' || !process.env.ANTHROPIC_API_KEY;
  
  // Format the assessment data into a string for the prompt
  const formattedData = assessmentData.map(assessment => {
    return `${assessment.type.toUpperCase()} ASSESSMENT:\n${assessment.responses.map((r, i) => {
      // Simulate question text from questionId if needed
      const questionText = `Question about ${r.questionId.replace(/-/g, ' ')}`;
      return `Question ${i+1}: ${questionText}\nAnswer: ${r.response}`;
    }).join('\n\n')}`;
  }).join('\n\n---\n\n');
  
  // Create enhanced prompt for better AI analysis
  const analysisPrompt = `
You are a specialized career advisor and educational consultant. Based on the assessment data below, provide a DETAILED analysis of recommended career paths, including:

1. RECOMMENDED CAREER PATHS (list at least 3 specific career paths):
   * For each career path include:
   * A specific job title (be specific, not general categories)
   * A brief description of the career
   * Education requirements (degrees, certifications, etc.)
   * Recommended college majors that align with this career (at least 2-3 specific majors)

2. STRENGTHS: List 3-5 key strengths based on the assessment data.

3. AREAS FOR DEVELOPMENT: List 3-5 areas where the student could improve.

4. RECOMMENDED NEXT STEPS: List 3-5 specific actions the student should take.

FORMAT YOUR RESPONSE WITH CLEAR HEADINGS AND BULLET POINTS.

ASSESSMENT DATA:
${formattedData}
`;

  try {
    let analysisText = '';
    
    // Try OpenAI first if configured
    if (useOpenAI) {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          temperature: 0.2,
          max_tokens: 2000,
          messages: [
            {
              role: "system",
              content: "You are a comprehensive career and education advisor expert. Analyze the assessment data and provide specific, tailored advice."
            },
            {
              role: "user",
              content: analysisPrompt
            }
          ],
        });

        if (completion.choices[0]?.message?.content) {
          analysisText = completion.choices[0].message.content;
        }
      } catch (error) {
        console.error("Error with OpenAI API:", error);
        // Fall back to Anthropic if OpenAI fails
        useOpenAI = false;
      }
    }
    
    // Use Anthropic if configured or as fallback
    if (!useOpenAI) {
      try {
        const anthropicResponse = await anthropic.messages.create({
          model: "claude-3-7-sonnet-20250219",
          max_tokens: 3000,
          temperature: 0.2,
          system: "You are a comprehensive career and education advisor expert. Analyze the assessment data and provide specific, tailored advice.",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: analysisPrompt
                }
              ]
            }
          ]
        });

        // Extract text from the response
        if (anthropicResponse.content && anthropicResponse.content.length > 0) {
          analysisText = anthropicResponse.content
            .map(block => {
              if (block.type === 'text') {
                return block.text;
              }
              return '';
            })
            .join('');
        }
      } catch (error) {
        console.error("Error with Anthropic API:", error);
        // If both APIs fail, use a fallback response
        if (!analysisText) {
          return getFallbackAnalysis();
        }
      }
    }
    
    // If we have analysis text, extract structured data
    if (analysisText) {
      return {
        careerPaths: extractCareerPaths(analysisText),
        strengths: extractStrengths(analysisText),
        improvementAreas: extractImprovementAreas(analysisText),
        recommendedSteps: extractRecommendedSteps(analysisText)
      };
    } else {
      return getFallbackAnalysis();
    }
  } catch (error) {
    console.error("Error generating AI analysis:", error);
    return getFallbackAnalysis();
  }
}

/**
 * Provides a fallback analysis if API calls fail
 */
function getFallbackAnalysis(): AIAnalysisResult {
  return {
    careerPaths: [
      {
        title: "Technology Professional",
        description: "Careers in software development, IT management, or data analysis.",
        educationRequirements: ["Bachelor's degree in Computer Science", "Technology certifications"],
        majorRecommendations: ["Computer Science", "Information Technology", "Data Science"]
      },
      {
        title: "Business Analyst",
        description: "Careers analyzing business needs and developing solutions.",
        educationRequirements: ["Bachelor's in Business or related field", "MBA advantageous"],
        majorRecommendations: ["Business Administration", "Economics", "Statistics"]
      }
    ],
    strengths: [
      "Strong analytical thinking",
      "Good communication skills",
      "Self-motivated learner",
      "Detail-oriented approach",
      "Adaptable to new challenges"
    ],
    improvementAreas: [
      "Developing specialized technical skills",
      "Building practical experience",
      "Expanding professional network",
      "Enhancing time management",
      "Building leadership skills"
    ],
    recommendedSteps: [
      "Research programs at colleges aligned with your career interests",
      "Seek hands-on experience in fields of interest",
      "Connect with professionals for informational interviews",
      "Take advanced courses in your areas of strength",
      "Develop a portfolio of achievements aligned with your goals"
    ]
  };
}

/**
 * Extract career paths from the AI analysis text
 */
function extractCareerPaths(text: string): CareerPath[] {
  // Find the career paths section
  const careerPathsSection = text.match(/recommended career paths.*?:.*?\n((?:.*?\n){1,30})/i);
  
  const careers: CareerPath[] = [];
  
  if (careerPathsSection && careerPathsSection[1]) {
    const content = careerPathsSection[1];
    
    // Split into potential career entries (looking for numbered or bullet points)
    const careerEntries = content.split(/(?=\n\d+\.|\n-|\n•)/).filter((entry: string) => entry.trim().length > 0);
    
    // Process each potential career entry
    for (const entry of careerEntries) {
      // Try to extract the title
      const titleMatch = entry.match(/^\s*(?:\d+\.|-|•)\s*([^:\n]+)(?::|$)/m);
      const title = titleMatch ? titleMatch[1].trim() : "Career option";
      
      // Extract description
      const descriptionMatch = entry.match(/description:?\s*([^\n]+)/i) || 
                             entry.match(/^\s*(?:\d+\.|-|•)\s*[^:\n]+:\s*([^\n]+)/m);
      const description = descriptionMatch ? descriptionMatch[1].trim() : 
                         "Career aligned with your assessment results.";
      
      // Extract education requirements
      const educationSection = entry.match(/education(?:\s+requirements)?:?\s*((?:[^\n]+\n?){1,5})/i);
      const educationRequirements: string[] = [];
      
      if (educationSection && educationSection[1]) {
        const educationText = educationSection[1];
        const requirements = educationText
          .split(/\n|;/)
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0 && !line.toLowerCase().includes('education'))
          .slice(0, 3);
        
        if (requirements.length > 0) {
          educationRequirements.push(...requirements);
        }
      }
      
      if (educationRequirements.length === 0) {
        educationRequirements.push("Bachelor's degree", "Advanced certification");
      }
      
      // Extract recommended majors
      const majorsSection = entry.match(/(?:recommended\s+)?majors?:?\s*((?:[^\n]+\n?){1,5})/i);
      const majorRecommendations: string[] = [];
      
      if (majorsSection && majorsSection[1]) {
        const majorsText = majorsSection[1];
        const majors = majorsText
          .split(/\n|;|,/)
          .map((line: string) => line.trim())
          .filter((line: string) => 
            line.length > 0 && 
            !line.toLowerCase().includes('major') && 
            !line.toLowerCase().includes('such as')
          )
          .slice(0, 3);
        
        if (majors.length > 0) {
          majorRecommendations.push(...majors);
        }
      }
      
      if (majorRecommendations.length === 0) {
        // Add default relevant majors based on the career title
        if (title.toLowerCase().includes('engineer') || title.toLowerCase().includes('developer')) {
          majorRecommendations.push("Computer Science", "Software Engineering", "Information Technology");
        } else if (title.toLowerCase().includes('business') || title.toLowerCase().includes('management')) {
          majorRecommendations.push("Business Administration", "Management", "Marketing");
        } else if (title.toLowerCase().includes('healthcare') || title.toLowerCase().includes('medical')) {
          majorRecommendations.push("Nursing", "Health Sciences", "Biology");
        } else {
          majorRecommendations.push("Relevant academic programs");
        }
      }
      
      careers.push({
        title,
        description,
        educationRequirements,
        majorRecommendations
      });
    }
  }
  
  // Return found careers, or defaults if none found
  return careers.length > 0 ? careers : [
    {
      title: "Technology Professional",
      description: "Careers in software development, IT management, or data analysis.",
      educationRequirements: ["Bachelor's degree in Computer Science", "Technology certifications"],
      majorRecommendations: ["Computer Science", "Information Technology", "Data Science"]
    },
    {
      title: "Business Analyst",
      description: "Careers analyzing business needs and developing solutions.",
      educationRequirements: ["Bachelor's in Business or related field", "MBA advantageous"],
      majorRecommendations: ["Business Administration", "Economics", "Statistics"]
    }
  ];
}

/**
 * Extract strengths from the AI analysis text
 */
function extractStrengths(text: string): string[] {
  // Simple extraction of strengths
  const strengthsSection = text.match(/strengths.*?:.*?\n((?:.*?\n){1,10})/i);
  if (strengthsSection && strengthsSection[1]) {
    return strengthsSection[1]
      .split('\n')
      .filter((line: string) => line.trim().startsWith('-') || line.trim().startsWith('•'))
      .map((line: string) => line.replace(/^[•\-]\s*/, '').trim())
      .filter((line: string) => line.length > 0)
      .slice(0, 5);
  }
  
  // Default strengths if extraction fails
  return [
    "Strong analytical thinking",
    "Good communication skills",
    "Self-motivated learner",
    "Detail-oriented approach",
    "Adaptable to new challenges"
  ];
}

/**
 * Extract improvement areas from the AI analysis text
 */
function extractImprovementAreas(text: string): string[] {
  // Simple extraction of improvement areas
  const improvementSection = text.match(/areas for development.*?:.*?\n((?:.*?\n){1,10})/i);
  if (improvementSection && improvementSection[1]) {
    return improvementSection[1]
      .split('\n')
      .filter((line: string) => line.trim().startsWith('-') || line.trim().startsWith('•'))
      .map((line: string) => line.replace(/^[•\-]\s*/, '').trim())
      .filter((line: string) => line.length > 0)
      .slice(0, 5);
  }
  
  // Default areas if extraction fails
  return [
    "Developing specialized technical skills",
    "Building practical experience",
    "Expanding professional network",
    "Enhancing time management",
    "Building leadership skills"
  ];
}

/**
 * Extract recommended steps from the AI analysis text
 */
function extractRecommendedSteps(text: string): string[] {
  // Simple extraction of recommended steps
  const stepsSection = text.match(/recommended next steps.*?:.*?\n((?:.*?\n){1,10})/i);
  if (stepsSection && stepsSection[1]) {
    return stepsSection[1]
      .split('\n')
      .filter((line: string) => line.trim().startsWith('-') || line.trim().startsWith('•') || line.trim().match(/^\d+\./))
      .map((line: string) => line.replace(/^[•\-\d\.]\s*/, '').trim())
      .filter((line: string) => line.length > 0)
      .slice(0, 5);
  }
  
  // Default steps if extraction fails
  return [
    "Research programs at colleges aligned with your career interests",
    "Seek hands-on experience in fields of interest",
    "Connect with professionals for informational interviews",
    "Take advanced courses in your areas of strength",
    "Develop a portfolio of achievements aligned with your goals"
  ];
}

/**
 * Main function to process assessment responses and generate recommendations
 */
export async function processAssessmentResponses(
  responses: AssessmentResponse[]
): Promise<AIRecommendation[]> {
  // Determine which AI service to use based on environment variables
  const useOpenAI = process.env.AI_SERVICE === 'openai' || !process.env.ANTHROPIC_API_KEY;
  
  try {
    if (useOpenAI) {
      return await processWithOpenAI(responses);
    } else {
      return await processWithClaude(responses);
    }
  } catch (openaiError) {
    // If OpenAI fails, try Claude as fallback
    if (useOpenAI && process.env.ANTHROPIC_API_KEY) {
      try {
        console.log('Falling back to Claude for assessment processing');
        return await processWithClaude(responses);
      } catch (claudeError) {
        console.error('Both OpenAI and Claude failed:', claudeError);
        throw claudeError;
      }
    } else {
      // No fallback available
      throw openaiError;
    }
  }
} 