'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import LoadingSpinner from '@/components/LoadingSpinner';
import ChatInterface from '@/components/ChatInterface';

interface ComprehensiveAnalysis {
  careerPaths: {
    title: string;
    description: string;
    educationRequirements: string[];
    majorRecommendations?: string[];
  }[];
  strengths: string[];
  improvementAreas: string[];
  recommendedSteps: string[];
}

export default function ComprehensiveResultsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ComprehensiveAnalysis | null>(null);
  const [allCompleted, setAllCompleted] = useState(false);
  const [missingAssessments, setMissingAssessments] = useState<string[]>([]);

  useEffect(() => {
    async function fetchComprehensiveResults() {
      try {
        setLoading(true);
        const response = await fetch('/api/assessments/comprehensive-results');
        
        // Parse the JSON response
        const data = await response.json();
        
        if (!response.ok) {
          // Handle actual HTTP errors (not assessment completion status)
          console.error('API error:', response.status, data);
          throw new Error(data.error || 'Failed to fetch comprehensive analysis');
        }
        
        // Check if all assessments are completed based on the 'completed' field
        if (!data.completed) {
          console.log('Assessment status:', data);
          setAllCompleted(false);
          
          if (data.requiredAssessments && data.completedAssessments) {
            const completed = new Set(data.completedAssessments);
            const required = data.requiredAssessments;
            const missing = required.filter((type: string) => !completed.has(type));
            setMissingAssessments(missing);
            console.log('Missing assessments:', missing);
          }
          return;
        }
        
        // Success case - we have a complete analysis
        setAnalysis(data.analysis);
        setAllCompleted(true);
      } catch (error) {
        console.error('Error fetching comprehensive results:', error);
        setError(error instanceof Error ? error.message : 'Failed to load your comprehensive analysis. Please try again later.');
      } finally {
        setLoading(false);
      }
    }

    fetchComprehensiveResults();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex justify-center items-center">
        <LoadingSpinner />
        <p className="ml-2">Loading your comprehensive analysis...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative mb-6">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
        <Link 
          href="/dashboard/assessment" 
          className="inline-flex items-center text-blue-600 hover:text-blue-800"
        >
          <ArrowLeftIcon className="h-4 w-4 mr-1" />
          Back to Assessments
        </Link>
      </div>
    );
  }

  if (!allCompleted) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-6 py-4 rounded-lg mb-6">
          <h2 className="text-xl font-semibold mb-2">Complete All Assessments First</h2>
          <p className="mb-4">
            You need to complete all four assessments to view your comprehensive analysis.
          </p>
          
          {missingAssessments.length > 0 && (
            <div className="mb-4">
              <h3 className="font-medium mb-2">You still need to complete:</h3>
              <ul className="list-disc list-inside space-y-1">
                {missingAssessments.map((type) => (
                  <li key={type}>
                    <Link 
                      href={`/dashboard/assessment/${type.toLowerCase()}`}
                      className="text-blue-600 hover:underline"
                    >
                      {type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()} Assessment
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          <Link 
            href="/dashboard/assessment" 
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Back to Assessments
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <Link 
          href="/dashboard/assessment" 
          className="inline-flex items-center text-blue-600 hover:text-blue-800"
        >
          <ArrowLeftIcon className="h-4 w-4 mr-1" />
          Back to Assessments
        </Link>
      </div>
      
      <div className="bg-white shadow-md rounded-lg p-6 mb-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Your Comprehensive Analysis</h1>
        
        <p className="text-gray-600 mb-8">
          Based on your responses across all four assessments, we&apos;ve generated a personalized analysis 
          to help guide your educational and career decisions.
        </p>
        
        {analysis && (
          <div className="space-y-8">
            {/* Career Paths */}
            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">
                Recommended Career Paths
              </h2>
              <div className="grid md:grid-cols-3 gap-6">
                {analysis.careerPaths.map((career, index) => (
                  <div key={index} className="bg-gray-50 rounded-lg p-5 border border-gray-200">
                    <h3 className="text-lg font-medium text-gray-800 mb-2">
                      {career.title}
                    </h3>
                    <p className="text-gray-600 mb-4">
                      {career.description}
                    </p>
                    
                    {/* Education Requirements */}
                    <div className="mb-4">
                      <h4 className="font-medium text-gray-700 mb-1">Education Requirements:</h4>
                      <ul className="list-disc list-inside text-gray-600 space-y-1">
                        {career.educationRequirements.map((req, i) => (
                          <li key={i}>{req}</li>
                        ))}
                      </ul>
                    </div>
                    
                    {/* Recommended Majors */}
                    <div>
                      <h4 className="font-medium text-gray-700 mb-1">Recommended Majors:</h4>
                      <ul className="list-disc list-inside text-gray-600 space-y-1">
                        {career.majorRecommendations?.map((major, i) => (
                          <li key={i}>{major}</li>
                        )) || (
                          <li>Relevant academic programs</li>
                        )}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            
            {/* Strengths */}
            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">
                Your Key Strengths
              </h2>
              <ul className="bg-green-50 rounded-lg p-5 border border-green-200 space-y-2">
                {analysis.strengths.map((strength, index) => (
                  <li key={index} className="flex items-start">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-green-200 text-green-800 mr-3">
                      ✓
                    </span>
                    <span>{strength}</span>
                  </li>
                ))}
              </ul>
            </section>
            
            {/* Areas for Improvement */}
            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">
                Areas for Development
              </h2>
              <ul className="bg-blue-50 rounded-lg p-5 border border-blue-200 space-y-2">
                {analysis.improvementAreas.map((area, index) => (
                  <li key={index} className="flex items-start">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-blue-200 text-blue-800 mr-3">
                      ↗
                    </span>
                    <span>{area}</span>
                  </li>
                ))}
              </ul>
            </section>
            
            {/* Recommended Next Steps */}
            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">
                Recommended Next Steps
              </h2>
              <ol className="bg-purple-50 rounded-lg p-5 border border-purple-200 space-y-4">
                {analysis.recommendedSteps.map((step, index) => (
                  <li key={index} className="flex items-start">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-purple-200 text-purple-800 mr-3">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </section>
            
            {/* Chat with AI Assistant */}
            <section>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">
                Chat with Your College Compass Assistant
              </h2>
              <p className="text-gray-600 mb-4">
                Have questions about your results or next steps? Our AI assistant can help provide personalized guidance based on your assessment results.
              </p>
              <ChatInterface studentName={analysis.careerPaths[0]?.title ? analysis.careerPaths[0].title.split(" ")[0] : "Student"} assessmentCompleted={true} />
            </section>
          </div>
        )}
      </div>
      
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
        <h2 className="text-lg font-semibold text-blue-800 mb-2">
          What&apos;s Next?
        </h2>
        <p className="text-blue-700 mb-4">
          This analysis is a starting point for your educational journey. Consider discussing these 
          results with a career counselor or academic advisor for further guidance.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link 
            href="/dashboard" 
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Return to Dashboard
          </Link>
          <Link 
            href="/dashboard/assessment" 
            className="inline-flex items-center px-4 py-2 border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50"
          >
            Retake Assessments
          </Link>
        </div>
      </div>
    </div>
  );
} 