'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AssessmentQuestionnaire from '@/components/AssessmentQuestionnaire';

// Define types locally to avoid importing from mongoose models
enum AssessmentType {
  PERSONALITY = 'personality',
  SKILLS = 'skills',
  INTERESTS = 'interests',
  APTITUDE = 'aptitude',
}

interface AssessmentOption {
  id: string;
  text: string;
  value: string | number;
}

interface AssessmentQuestion {
  id: string;
  text: string;
  type: 'scale' | 'multiple_choice' | 'open_ended';
  options?: AssessmentOption[];
}

interface AssessmentResponse {
  questionId: string;
  questionText: string;
  response: string | number;
}

interface PageProps {
  params: {
    type: string;
  };
}

interface AssessmentData {
  questions: AssessmentQuestion[];
  title: string;
  type: AssessmentType;
  description: string;
}

interface AIRecommendation {
  fieldOfStudy: string;
  description: string;
  careerPaths: string[];
  coursesRecommended: string[];
  strengthsHighlighted: string[];
  areasForGrowth: string[];
  confidenceScore: number;
}

export default function AssessmentPage({ params }: PageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assessmentData, setAssessmentData] = useState<AssessmentData | null>(null);
  const [showResults, setShowResults] = useState(false);
  const router = useRouter();
  
  // Store the assessment type in state to avoid referencing params directly
  const [assessmentType, setAssessmentType] = useState<AssessmentType | null>(null);

  // First effect just to safely set the assessment type from params
  useEffect(() => {
    if (params && params.type) {
      setAssessmentType(params.type as AssessmentType);
    }
  }, [params]);

  // Second effect for fetching data, depends on assessmentType state
  useEffect(() => {
    // Only proceed if assessmentType is set
    if (!assessmentType) return;
    
    async function fetchQuestions() {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(`/api/assessments/questions/${assessmentType}`);
        if (!response.ok) {
          throw new Error('Failed to fetch assessment questions');
        }

        const data = await response.json();
        setAssessmentData(data);
      } catch (error) {
        console.error('Error fetching assessment questions:', error);
        setError('Failed to load questions. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    }

    // Check if there are already results for this assessment type
    async function checkExistingResults() {
      try {
        const response = await fetch(`/api/assessments/results/${assessmentType}`);
        
        if (response.ok) {
          // Results exist, redirect to results page
          router.push(`/dashboard/assessment/${assessmentType}/results`);
          return;
        }
        
        // No results or 404, continue with fetching questions
        await fetchQuestions();
      } catch (err) {
        console.error('Error checking results:', err);
        // Error means no results, continue with fetching questions
        await fetchQuestions();
      }
    }

    checkExistingResults();
  }, [assessmentType, router]);

  const handleSubmit = async (responses: AssessmentResponse[]) => {
    if (!assessmentType) return;
    
    try {
      setSubmitting(true);
      setError(null);

      const response = await fetch('/api/assessments/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: assessmentType,
          responses,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit assessment');
      }

      // Simply redirect to assessment list page with a success message
      router.push('/dashboard/assessment?completed=' + assessmentType);
    } catch (error) {
      console.error('Error submitting assessment:', error);
      setError('Failed to submit assessment. Please try again later.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setShowResults(false);
    router.push('/dashboard/assessment');
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
        <Link href="/dashboard/assessment" className="text-indigo-600 hover:text-indigo-800 mt-2 inline-block">
          Return to Assessments
        </Link>
      </div>
    );
  }

  if (showResults) {
    return (
      <AssessmentResults recommendations={[]} handleReset={handleReset} />
    );
  }

  if (!assessmentData) {
    return (
      <div className="text-center">
        <p>No assessment data available.</p>
        <Link href="/dashboard/assessment" className="text-indigo-600 hover:text-indigo-800 mt-2 inline-block">
          Return to Assessments
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">{assessmentData.title}</h1>
          <Link
            href="/dashboard/assessment"
            className="text-indigo-600 hover:text-indigo-800"
          >
            Back to Assessments
          </Link>
        </div>
        <p className="mt-2 text-gray-600">{assessmentData.description}</p>
      </div>

      <AssessmentQuestionnaire
        assessmentType={assessmentData.type}
        questions={assessmentData.questions}
        onSubmit={handleSubmit}
        isLoading={submitting}
      />
    </div>
  );
}

interface AssessmentResultsProps {
  recommendations: AIRecommendation[];
  handleReset: () => void;
}

function AssessmentResults({ recommendations, handleReset }: AssessmentResultsProps) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Assessment Results</h1>
        <button
          onClick={handleReset}
          className="text-indigo-600 hover:text-indigo-800"
        >
          Back to Assessments
        </button>
      </div>

      <div className="mb-6">
        <p className="text-lg text-gray-700">
          Based on your responses, we recommend these fields of study:
        </p>
      </div>

      <div className="space-y-8">
        {recommendations.map((recommendation, index) => (
          <div key={index} className="bg-indigo-50 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-indigo-900 mb-2">
              {recommendation.fieldOfStudy}
            </h2>
            <p className="text-gray-700 mb-4">{recommendation.description}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium text-indigo-800 mb-2">Potential Career Paths</h3>
                <ul className="list-disc list-inside text-gray-700 space-y-1">
                  {recommendation.careerPaths.map((career, i) => (
                    <li key={i}>{career}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="font-medium text-indigo-800 mb-2">Recommended Courses</h3>
                <ul className="list-disc list-inside text-gray-700 space-y-1">
                  {recommendation.coursesRecommended.map((course, i) => (
                    <li key={i}>{course}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium text-indigo-800 mb-2">Your Strengths</h3>
                <ul className="list-disc list-inside text-gray-700 space-y-1">
                  {recommendation.strengthsHighlighted.map((strength, i) => (
                    <li key={i}>{strength}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="font-medium text-indigo-800 mb-2">Areas for Growth</h3>
                <ul className="list-disc list-inside text-gray-700 space-y-1">
                  {recommendation.areasForGrowth.map((area, i) => (
                    <li key={i}>{area}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 text-center">
        <Link
          href={`/dashboard/assessment/results`}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          View Full Results
        </Link>
      </div>
    </div>
  );
} 