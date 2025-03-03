'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRightIcon } from '@heroicons/react/24/outline';
import ChatInterface from '@/components/ChatInterface';

// Define assessment types locally to avoid import issues
enum AssessmentType {
  PERSONALITY = 'personality',
  SKILLS = 'skills',
  INTERESTS = 'interests',
  APTITUDE = 'aptitude',
}

function getAssessmentDescription(type: string): string {
  switch (type.toLowerCase()) {
    case 'personality':
      return 'Understand how your personality traits align with different educational and career paths.';
    case 'skills':
      return 'Identify your strongest skills and abilities that can be leveraged in your education.';
    case 'interests':
      return 'Discover subject areas and activities that naturally engage and motivate you.';
    case 'aptitude':
      return 'Measure your natural potential and abilities in different academic areas.';
    default:
      return 'Complete this assessment to learn more about yourself.';
  }
}

// Define a type for the structure that the API actually returns
interface AssessmentStatusesResponse {
  success: boolean;
  statuses: Record<string, string>;
  user?: {
    name: string;
    email: string;
  };
}

export default function AssessmentPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assessmentStatuses, setAssessmentStatuses] = useState<Record<string, string>>({});
  const [allCompleted, setAllCompleted] = useState(false);
  const [userName, setUserName] = useState<string>("Student");
  const searchParams = useSearchParams();

  useEffect(() => {
    // Check success message from query params
    const success = searchParams.get('success');
    if (success) {
      // Handle success message if needed
    }

    // Fetch assessments status
    async function fetchAssessmentStatus() {
      try {
        setLoading(true);
        const response = await fetch('/api/assessments/status');
        
        if (!response.ok) {
          throw new Error('Failed to fetch assessment status');
        }
        
        const data: AssessmentStatusesResponse = await response.json();
        
        if (data.success && data.statuses) {
          setAssessmentStatuses(data.statuses);
          
          // Check if all assessments are completed
          const allAssessmentTypes = Object.values(AssessmentType);
          const allDone = allAssessmentTypes.every(type => 
            data.statuses[type.toLowerCase()] === 'completed'
          );
          setAllCompleted(allDone);
        } else {
          setAssessmentStatuses({});
          setAllCompleted(false);
        }
        
        if (data.user && data.user.name) {
          setUserName(data.user.name);
        }
      } catch (error) {
        console.error('Error fetching assessment status:', error);
        setError(error instanceof Error ? error.message : 'Failed to load assessment status');
      } finally {
        setLoading(false);
      }
    }

    fetchAssessmentStatus();
  }, [searchParams]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-indigo-500"></div>
        <span className="ml-3">Loading assessments...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative">
        <strong className="font-bold">Error: </strong>
        <span className="block sm:inline">{error}</span>
      </div>
    );
  }

  // Count how many assessments remain to be completed
  const remainingCount = Object.values(AssessmentType).filter(type => 
    assessmentStatuses[type.toLowerCase()] !== 'completed'
  ).length;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Career & College Assessments</h1>
      
      <p className="text-gray-600 mb-8">
        Complete all four assessments to receive a comprehensive analysis of your
        strengths, interests, and potential career paths.
      </p>
      
      {/* Assessment Grid */}
      <div className="grid md:grid-cols-2 gap-6 mb-10">
        {Object.values(AssessmentType).map((type) => {
          const typeKey = type.toLowerCase();
          const isCompleted = assessmentStatuses[typeKey] === 'completed';
          
          return (
            <div key={type} className="bg-white rounded-lg shadow-md overflow-hidden">
              <div className="p-6">
                <h2 className="text-lg font-medium text-gray-900">
                  {type.charAt(0).toUpperCase() + type.slice(1)} Assessment
                </h2>
                <p className="mt-2 text-sm text-gray-500">
                  {getAssessmentDescription(type)}
                </p>
                <div className="mt-4">
                  {isCompleted ? (
                    <div className="flex items-center text-green-600">
                      <span>✓ Completed</span>
                    </div>
                  ) : (
                    <div className="text-gray-500">Not completed</div>
                  )}
                </div>
              </div>
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                {isCompleted ? (
                  <div className="flex space-x-4">
                    <Link
                      href={`/dashboard/assessment/${typeKey}`}
                      className="text-indigo-600 hover:text-indigo-900 font-medium"
                    >
                      View Results
                    </Link>
                    <Link
                      href={`/dashboard/assessment/${typeKey}?retake=true`}
                      className="text-indigo-600 hover:text-indigo-900 font-medium"
                    >
                      Retake Assessment
                    </Link>
                  </div>
                ) : (
                  <Link
                    href={`/dashboard/assessment/${typeKey}`}
                    className="inline-flex items-center px-4 py-2 bg-indigo-600 border border-transparent rounded-md font-medium text-white hover:bg-indigo-700"
                  >
                    Start Assessment
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Comprehensive Analysis Button */}
      <div className="mb-10">
        <div className="bg-white shadow-md rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Comprehensive Analysis</h2>
          <p className="text-gray-600 mb-4">
            Once you complete all assessments, you&apos;ll receive a personalized
            analysis combining insights from all your results.
          </p>
          
          {allCompleted ? (
            <Link
              href="/dashboard/assessment/comprehensive-results"
              className="inline-flex items-center justify-center px-5 py-2 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
            >
              View Your Comprehensive Analysis
              <ArrowRightIcon className="ml-2 h-5 w-5" />
            </Link>
          ) : (
            <div>
              <button
                disabled
                className="inline-flex items-center justify-center px-5 py-2 border border-transparent text-base font-medium rounded-md text-white bg-gray-400 cursor-not-allowed"
              >
                Complete All Assessments First
              </button>
              <p className="text-sm text-gray-500 mt-2">
                {remainingCount} remaining
              </p>
            </div>
          )}
        </div>
      </div>
      
      {/* Chat Interface */}
      <div className="mb-10">
        <div className="bg-white shadow-md rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Need Help or Have Questions?</h2>
          <p className="text-gray-600 mb-4">
            Our AI assistant can provide guidance on assessments, explain results, and help you plan your college journey.
          </p>
          <ChatInterface 
            studentName={userName} 
            assessmentCompleted={allCompleted} 
          />
        </div>
      </div>
    </div>
  );
} 