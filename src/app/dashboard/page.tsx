'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface DashboardData {
  user: {
    name: string;
    grade: number;
  };
  completedAssessments: number;
  totalAssessments: number;
  recommendedFields: string[];
  upcomingDeadlines: Array<{
    id: string;
    title: string;
    dueDate: string;
    type: string;
  }>;
}

function AssessmentProgressCard({ completed, total }: { completed: number; total: number }) {
  const progressPercentage = (completed / total) * 100;

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Assessment Progress</h3>
      <div className="mb-2 flex justify-between items-center">
        <span className="text-sm text-gray-600">
          {completed} of {total} completed
        </span>
        <span className="text-sm font-medium text-indigo-600">{progressPercentage}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
        <div
          className="bg-indigo-600 h-2.5 rounded-full"
          style={{ width: `${progressPercentage}%` }}
        ></div>
      </div>
      <Link
        href="/dashboard/assessment"
        className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
      >
        {completed < total ? 'Continue assessments →' : 'View your results →'}
      </Link>
    </div>
  );
}

function RecommendedFieldsCard({ fields }: { fields: string[] }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Recommended Fields of Study</h3>
      {fields.length > 0 ? (
        <ul className="space-y-2">
          {fields.map((field, index) => (
            <li key={index} className="flex items-start">
              <span className="flex-shrink-0 h-5 w-5 text-indigo-500">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
              <span className="ml-2 text-gray-700">{field}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-500 text-sm">
          Complete your assessments to see recommended fields of study.
        </p>
      )}
      <div className="mt-4">
        <Link
          href="/dashboard/academic-plan"
          className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
        >
          View detailed recommendations →
        </Link>
      </div>
    </div>
  );
}

function UpcomingDeadlinesCard({
  deadlines,
}: {
  deadlines: DashboardData['upcomingDeadlines'];
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Upcoming Deadlines</h3>
      {deadlines.length > 0 ? (
        <ul className="divide-y divide-gray-200">
          {deadlines.map((deadline) => (
            <li key={deadline.id} className="py-3">
              <div className="flex justify-between">
                <p className="text-sm font-medium text-gray-900">{deadline.title}</p>
                <span
                  className={`px-2 py-1 text-xs rounded-full ${
                    deadline.type === 'application'
                      ? 'bg-red-100 text-red-800'
                      : deadline.type === 'assessment'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-green-100 text-green-800'
                  }`}
                >
                  {deadline.type}
                </span>
              </div>
              <p className="text-sm text-gray-500">
                Due: {new Date(deadline.dueDate).toLocaleDateString()}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-500 text-sm">No upcoming deadlines.</p>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userData, setUserData] = useState<{ name: string; grade: number } | null>(null);

  // Fetch user data
  useEffect(() => {
    async function fetchUserData() {
      try {
        const response = await fetch('/api/user/profile');
        if (!response.ok) {
          throw new Error('Failed to fetch user data');
        }
        const data = await response.json();
        setUserData({
          name: data.name,
          grade: data.grade || 9,
        });
      } catch (error) {
        console.error('Error fetching user data:', error);
        // Fallback to demo data if API call fails
        setUserData({
          name: 'Student',
          grade: 11,
        });
      }
    }

    fetchUserData();
  }, []);

  // Fetch dashboard data
  useEffect(() => {
    async function fetchDashboardData() {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch('/api/dashboard/recommendations');
        if (!response.ok) {
          throw new Error('Failed to fetch recommendations');
        }

        const recommendationsData = await response.json();
        
        // Combine with user data to create complete dashboard data
        setData({
          user: userData || { name: 'Student', grade: 11 },
          completedAssessments: recommendationsData.completedAssessments || 0,
          totalAssessments: recommendationsData.totalAssessments || 4,
          recommendedFields: recommendationsData.recommendedFields || [],
          upcomingDeadlines: recommendationsData.upcomingDeadlines || [],
        });
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
        setError('Failed to load dashboard data. Please try again later.');
        
        // Fallback to demo data if API call fails
        setData({
          user: userData || { name: 'Student', grade: 11 },
          completedAssessments: 2,
          totalAssessments: 4,
          recommendedFields: [
            'Computer Science',
            'Engineering',
            'Business Administration',
            'Psychology',
          ],
          upcomingDeadlines: [
            {
              id: '1',
              title: 'Complete Interests Assessment',
              dueDate: '2023-12-01',
              type: 'assessment',
            },
            {
              id: '2',
              title: 'Update Academic Plan',
              dueDate: '2023-12-15',
              type: 'academic',
            },
          ],
        });
      } finally {
        setIsLoading(false);
      }
    }

    // Only fetch dashboard data once we have user data
    if (userData) {
      fetchDashboardData();
    }
  }, [userData]);

  if (isLoading || !data) {
    return (
      <div className="flex justify-center items-center min-h-screen -mt-16">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-800 rounded-md p-4 text-sm">
          {error}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {data.user.name}!
        </h1>
        <p className="text-gray-600">
          Grade {data.user.grade} • {new Date().toLocaleDateString()}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <AssessmentProgressCard
          completed={data.completedAssessments}
          total={data.totalAssessments}
        />
        <RecommendedFieldsCard fields={data.recommendedFields} />
        <UpcomingDeadlinesCard deadlines={data.upcomingDeadlines} />
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">Your Journey</h3>
          <span className="text-sm text-gray-500">Grade {data.user.grade}</span>
        </div>
        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-gray-300"></div>
          </div>
          <div className="relative flex justify-between">
            {[9, 10, 11, 12].map((grade) => (
              <div
                key={grade}
                className={`flex items-center justify-center w-8 h-8 rounded-full ${
                  grade < data.user.grade
                    ? 'bg-indigo-600 text-white'
                    : grade === data.user.grade
                    ? 'ring-2 ring-indigo-600 bg-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {grade}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-6">
          <h4 className="text-sm font-medium text-gray-900 mb-2">Next Steps:</h4>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-center">
              <svg
                className="h-4 w-4 text-indigo-500 mr-2"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              Complete all personality and skills assessments
            </li>
            <li className="flex items-center">
              <svg
                className="h-4 w-4 text-indigo-500 mr-2"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              Review and update your academic plan for next semester
            </li>
            <li className="flex items-center">
              <svg
                className="h-4 w-4 text-gray-400 mr-2"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v5.586l-1.293-1.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 12.586V7z"
                  clipRule="evenodd"
                />
              </svg>
              Start researching colleges that match your interests
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
} 