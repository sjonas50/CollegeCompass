'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// Define enum locally to avoid importing from mongoose models
enum AssessmentType {
  PERSONALITY = 'personality',
  SKILLS = 'skills',
  INTERESTS = 'interests',
  APTITUDE = 'aptitude',
}

interface PageParams {
  type: string;
}

interface PageProps {
  params: Promise<PageParams>;
}

interface AssessmentResultsData {
  assessmentId: string;
  type: AssessmentType;
  completedAt: string;
  results: {
    category: string;
    score: number;
    description?: string;
  }[];
  recommendations: {
    fieldOfStudy: string;
    description: string;
    careerPaths: string[];
    coursesRecommended: string[];
    strengthsHighlighted: string[];
    areasForGrowth: string[];
    confidenceScore: number;
  }[];
  overview: {
    topStrengths: string[];
    areasForGrowth: string[];
    summary: string;
  };
}

export default function AssessmentResultsPage({ params }: PageProps) {
  // Unwrap params using React.use() with proper typing
  const unwrappedParams = use(params) as PageParams;
  const type = unwrappedParams.type;
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resultsData, setResultsData] = useState<AssessmentResultsData | null>(null);
  const router = useRouter();
  
  // Store the assessment type in state to avoid referencing params directly
  const [assessmentType, setAssessmentType] = useState<AssessmentType | null>(null);

  // First effect just to safely set the assessment type from unwrapped params
  useEffect(() => {
    if (type) {
      setAssessmentType(type as AssessmentType);
    }
  }, [type]);

  // Second effect for fetching data, depends on assessmentType state
  useEffect(() => {
    // Only proceed if assessmentType is set
    if (!assessmentType) return;
    
    async function fetchResults() {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(`/api/assessments/results/${assessmentType}`);
        
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('You have not completed this assessment yet');
          } else {
            throw new Error('Failed to fetch assessment results');
          }
        }

        const data = await response.json();
        setResultsData(data);
      } catch (error) {
        console.error('Error fetching assessment results:', error);
        if (error instanceof Error) {
          setError(error.message);
        } else {
          setError('Failed to load results. Please try again later.');
        }
      } finally {
        setIsLoading(false);
      }
    }

    fetchResults();
  }, [assessmentType]);

  const handleRetakeAssessment = () => {
    if (!assessmentType) return;
    router.push(`/dashboard/assessment/${assessmentType}`);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-800 rounded-md p-4 mb-6">
        <p>{error}</p>
        {error === 'You have not completed this assessment yet' && assessmentType && (
          <Link 
            href={`/dashboard/assessment/${assessmentType}`} 
            className="text-indigo-600 hover:text-indigo-800 mt-2 inline-block font-medium"
          >
            Take this assessment
          </Link>
        )}
        <Link 
          href="/dashboard/assessment" 
          className="text-indigo-600 hover:text-indigo-800 mt-2 ml-4 inline-block font-medium"
        >
          Return to Assessments
        </Link>
      </div>
    );
  }

  if (!resultsData) {
    return (
      <div className="text-center">
        <p>No assessment results available.</p>
        <Link 
          href="/dashboard/assessment" 
          className="text-indigo-600 hover:text-indigo-800 mt-2 inline-block"
        >
          Return to Assessments
        </Link>
      </div>
    );
  }

  // Format the date for display
  const formattedDate = new Date(resultsData.completedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Get a title for the assessment type
  const getAssessmentTitle = (type: AssessmentType) => {
    switch (type) {
      case AssessmentType.PERSONALITY:
        return 'Personality Assessment';
      case AssessmentType.SKILLS:
        return 'Skills Assessment';
      case AssessmentType.INTERESTS:
        return 'Interests Assessment';
      case AssessmentType.APTITUDE:
        return 'Aptitude Assessment';
      default:
        return 'Assessment';
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{getAssessmentTitle(resultsData.type)} Results</h1>
          <p className="text-gray-600">Completed on {formattedDate}</p>
        </div>
        <div className="flex space-x-4">
          <button
            onClick={handleRetakeAssessment}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            Retake Assessment
          </button>
          <Link
            href="/dashboard/assessment"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            All Assessments
          </Link>
        </div>
      </div>

      {/* Overview section */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Overview</h2>
        <p className="text-gray-700 mb-6">{resultsData.overview.summary}</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-indigo-800 mb-2">Your Top Strengths</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              {resultsData.overview.topStrengths && resultsData.overview.topStrengths.map((strength, index) => (
                <li key={index}>{strength}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-indigo-800 mb-2">Areas for Growth</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              {resultsData.overview.areasForGrowth && resultsData.overview.areasForGrowth.map((area, index) => (
                <li key={index}>{area}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Detailed results section */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Detailed Results</h2>
        
        <div className="space-y-6">
          {resultsData.results && resultsData.results.map((result, index) => (
            <div key={index} className="border-b border-gray-200 pb-4 last:border-b-0 last:pb-0">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-medium text-gray-900">{result.category}</h3>
                <div className="bg-indigo-100 text-indigo-800 px-2 py-1 rounded-full text-sm">
                  Score: {result.score}
                </div>
              </div>
              {result.description && <p className="text-gray-700">{result.description}</p>}
            </div>
          ))}
        </div>
      </div>
      
      {/* Recommendations section */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Recommendations</h2>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {resultsData.recommendations && resultsData.recommendations.map((recommendation, index) => (
            <div key={index} className="border border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-medium text-indigo-700">{recommendation.fieldOfStudy}</h3>
                <div className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs">
                  Match: {recommendation.confidenceScore}%
                </div>
              </div>
              
              <p className="text-gray-700 mb-4">{recommendation.description}</p>
              
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-1">Potential Career Paths</h4>
                  <ul className="list-disc list-inside text-gray-700 text-sm">
                    {recommendation.careerPaths && recommendation.careerPaths.map((career, i) => (
                      <li key={i}>{career}</li>
                    ))}
                  </ul>
                </div>
                
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-1">Recommended Courses</h4>
                  <ul className="list-disc list-inside text-gray-700 text-sm">
                    {recommendation.coursesRecommended && recommendation.coursesRecommended.map((course, i) => (
                      <li key={i}>{course}</li>
                    ))}
                  </ul>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 mb-1">Your Matching Strengths</h4>
                    <ul className="list-disc list-inside text-gray-700 text-sm">
                      {recommendation.strengthsHighlighted && recommendation.strengthsHighlighted.map((strength, i) => (
                        <li key={i}>{strength}</li>
                      ))}
                    </ul>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 mb-1">Areas to Develop</h4>
                    <ul className="list-disc list-inside text-gray-700 text-sm">
                      {recommendation.areasForGrowth && recommendation.areasForGrowth.map((area, i) => (
                        <li key={i}>{area}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="flex justify-between space-x-4">
        <Link
          href="/dashboard/assessment"
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
        >
          Back to Assessments
        </Link>
        
        <Link
          href="/dashboard/assessment/comprehensive-results"
          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-indigo-700 bg-white hover:bg-gray-50"
        >
          View Comprehensive Analysis
        </Link>
      </div>
    </div>
  );
} 