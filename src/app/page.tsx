import Link from 'next/link';

export default function LandingPage() {
  const currentYear = new Date().getFullYear();
  
  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white">
      {/* Header */}
      <header className="px-6 py-4 md:px-12 md:py-6 flex justify-between items-center">
        <div className="flex items-center">
          <h1 className="text-2xl font-bold text-indigo-600">College Compass</h1>
        </div>
        <div className="flex space-x-4">
          <Link
            href="/login"
            className="px-4 py-2 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            Log in
          </Link>
          <Link
            href="/register"
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
          >
            Sign up
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="px-6 py-12 md:px-12 md:py-24 mx-auto max-w-7xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
              Your AI-Powered College Guidance Counselor
            </h2>
            <p className="text-xl text-gray-600 mb-8">
              College Compass helps high school students navigate their educational journey with AI-driven assessments, personalized recommendations, and powerful academic planning tools.
            </p>
            <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
              <Link
                href="/register"
                className="px-6 py-3 text-base font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 text-center"
              >
                Get Started
              </Link>
              <Link
                href="/login"
                className="px-6 py-3 text-base font-medium text-indigo-600 bg-white border border-indigo-600 rounded-md hover:bg-indigo-50 text-center"
              >
                Log In
              </Link>
            </div>
          </div>
          <div className="hidden md:flex justify-center items-center">
            <div className="relative h-80 w-full">
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg opacity-10"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-48 h-48 text-indigo-500" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-6 py-12 md:px-12 md:py-24 mx-auto max-w-7xl bg-white">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
          Comprehensive Tools for Your Academic Success
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="p-6 border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Personalized Assessments
            </h3>
            <p className="text-gray-600">
              Discover your unique strengths, interests, skills, and aptitudes through comprehensive assessments that give you insights into your ideal educational path.
            </p>
          </div>
          <div className="p-6 border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              AI-Powered Recommendations
            </h3>
            <p className="text-gray-600">
              Receive personalized college and career recommendations based on your assessment results, aligned with your unique profile and goals.
            </p>
          </div>
          <div className="p-6 border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
                <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Academic Roadmaps
            </h3>
            <p className="text-gray-600">
              Create customized high school academic plans aligned with your college admission goals, including detailed four-year planning and extracurricular recommendations.
            </p>
          </div>
        </div>
      </section>

      {/* New Feature Showcase */}
      <section className="px-6 py-12 md:px-12 md:py-16 mx-auto max-w-7xl">
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl p-8 md:p-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div>
              <span className="inline-block px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-medium mb-4">
                NEW FEATURE
              </span>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Course Tracker & GPA Calculator
              </h2>
              <p className="text-gray-600 text-lg mb-6">
                Keep track of your academic progress with our new Course Tracker. Add courses, record grades, and watch your GPA calculate automatically. Plan your semesters and stay on top of your academic achievements.
              </p>
              <ul className="space-y-2 mb-6">
                <li className="flex items-center text-gray-600">
                  <svg className="w-5 h-5 mr-2 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Track courses by semester and year
                </li>
                <li className="flex items-center text-gray-600">
                  <svg className="w-5 h-5 mr-2 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Automatic GPA calculation
                </li>
                <li className="flex items-center text-gray-600">
                  <svg className="w-5 h-5 mr-2 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Support for different course types (Regular, Honors, AP)
                </li>
              </ul>
              <Link
                href="/register"
                className="inline-block px-5 py-3 text-base font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
              >
                Try It Now
              </Link>
            </div>
            <div className="rounded-lg bg-white p-4 shadow-lg">
              <div className="w-full h-64 bg-indigo-50 rounded-lg flex items-center justify-center">
                <svg className="w-32 h-32 text-indigo-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                  <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonial Section */}
      <section className="px-6 py-12 md:px-12 md:py-24 mx-auto max-w-7xl bg-white">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
          What Students Are Saying
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="p-6 border border-gray-200 rounded-lg bg-white shadow">
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
                <span className="text-indigo-600 font-bold">JD</span>
              </div>
              <div className="ml-4">
                <h3 className="font-semibold text-gray-900">Jamie D.</h3>
                <p className="text-gray-500 text-sm">High School Junior</p>
              </div>
            </div>
            <p className="text-gray-600 italic">
              &ldquo;College Compass helped me discover college options I hadn&apos;t even considered. The personalized recommendations based on my assessments were spot on!&rdquo;
            </p>
          </div>
          <div className="p-6 border border-gray-200 rounded-lg bg-white shadow">
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
                <span className="text-indigo-600 font-bold">MR</span>
              </div>
              <div className="ml-4">
                <h3 className="font-semibold text-gray-900">Michael R.</h3>
                <p className="text-gray-500 text-sm">High School Senior</p>
              </div>
            </div>
            <p className="text-gray-600 italic">
              &ldquo;The academic planning feature gave me a clear roadmap for my final year. I know exactly what I need to accomplish to get into my dream schools.&rdquo;
            </p>
          </div>
          <div className="p-6 border border-gray-200 rounded-lg bg-white shadow">
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
                <span className="text-indigo-600 font-bold">SK</span>
              </div>
              <div className="ml-4">
                <h3 className="font-semibold text-gray-900">Sarah K.</h3>
                <p className="text-gray-500 text-sm">High School Sophomore</p>
              </div>
            </div>
            <p className="text-gray-600 italic">
              &ldquo;The course tracker has been a game-changer for keeping my GPA on track. I can see exactly how each class affects my overall GPA and plan accordingly.&rdquo;
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-6 py-12 md:px-12 md:py-24 mx-auto max-w-7xl">
        <div className="bg-indigo-600 rounded-2xl px-6 py-10 md:py-16 text-center">
          <h2 className="text-3xl font-bold text-white mb-6">
            Start Your Educational Journey Today
          </h2>
          <p className="text-indigo-100 text-lg mb-8 max-w-3xl mx-auto">
            Join College Compass and unlock your educational potential with personalized guidance, powerful planning tools, and AI-driven insights.
          </p>
          <Link
            href="/register"
            className="inline-block px-6 py-3 text-base font-medium text-indigo-600 bg-white rounded-md hover:bg-indigo-50"
          >
            Create Free Account
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 md:px-12 border-t border-gray-200">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center">
          <div className="mb-4 md:mb-0">
            <p className="text-gray-500 text-sm">© {currentYear} College Compass. All rights reserved.</p>
          </div>
          <div className="flex space-x-6">
            <a href="#" className="text-gray-500 hover:text-gray-700 text-sm">Privacy Policy</a>
            <a href="#" className="text-gray-500 hover:text-gray-700 text-sm">Terms of Service</a>
            <a href="#" className="text-gray-500 hover:text-gray-700 text-sm">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
