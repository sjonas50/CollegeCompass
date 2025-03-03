'use client';

import { useState } from 'react';

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
  assessmentType: AssessmentType;
}

interface AssessmentQuestionnaireProps {
  assessmentType: AssessmentType;
  questions: AssessmentQuestion[];
  onSubmit: (responses: AssessmentResponse[]) => void;
  isLoading: boolean;
}

export default function AssessmentQuestionnaire({
  assessmentType,
  questions,
  onSubmit,
  isLoading,
}: AssessmentQuestionnaireProps) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [responses, setResponses] = useState<AssessmentResponse[]>([]);
  const [currentResponse, setCurrentResponse] = useState<string | number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentQuestion = questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questions.length - 1;
  const progress = ((currentQuestionIndex + 1) / questions.length) * 100;

  const handleResponseChange = (value: string | number) => {
    setCurrentResponse(value);
    setError(null);
  };

  const handleNextQuestion = () => {
    if (!currentResponse && currentQuestion.type !== 'open_ended') {
      setError('Please select an answer before continuing');
      return;
    }

    // Save the current response
    const newResponses = [...responses];
    newResponses[currentQuestionIndex] = {
      questionId: currentQuestion.id,
      questionText: currentQuestion.text,
      response: currentResponse as string | number,
      assessmentType: assessmentType,
    };
    setResponses(newResponses);

    // Move to the next question or submit if on the last question
    if (isLastQuestion) {
      onSubmit(newResponses);
    } else {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      // Reset the current response for the next question
      setCurrentResponse(null);
    }
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
      setCurrentResponse(responses[currentQuestionIndex - 1]?.response || null);
    }
  };

  // Render the current question based on its type
  const renderQuestion = () => {
    if (!currentQuestion) return null;

    switch (currentQuestion.type) {
      case 'scale':
        return (
          <div className="mt-4">
            <div className="flex justify-between mb-2">
              {currentQuestion.options?.map((option) => (
                <div key={option.id} className="text-xs text-gray-500">
                  {option.text}
                </div>
              ))}
            </div>
            <div className="flex justify-between space-x-2">
              {currentQuestion.options?.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleResponseChange(option.value)}
                  className={`flex-1 py-2 px-4 rounded-md transition-colors ${
                    currentResponse === option.value
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                  }`}
                >
                  {option.value}
                </button>
              ))}
            </div>
          </div>
        );

      case 'multiple_choice':
        return (
          <div className="mt-4 space-y-2">
            {currentQuestion.options?.map((option) => (
              <div key={option.id} className="flex items-center">
                <input
                  type="radio"
                  id={option.id}
                  name={currentQuestion.id}
                  value={option.value as string}
                  checked={currentResponse === option.value}
                  onChange={() => handleResponseChange(option.value)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                />
                <label htmlFor={option.id} className="ml-3 block text-gray-700">
                  {option.text}
                </label>
              </div>
            ))}
          </div>
        );

      case 'open_ended':
        return (
          <div className="mt-4">
            <textarea
              rows={4}
              value={currentResponse as string || ''}
              onChange={(e) => handleResponseChange(e.target.value)}
              placeholder="Enter your response..."
              className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6">
      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2.5 mb-6">
        <div
          className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        ></div>
      </div>

      <div className="mb-4 text-gray-500 text-sm">
        Question {currentQuestionIndex + 1} of {questions.length}
      </div>

      {/* Question text */}
      <h3 className="text-lg font-medium text-gray-900 mb-4">{currentQuestion?.text}</h3>

      {/* Question inputs */}
      {renderQuestion()}

      {/* Error message */}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {/* Navigation buttons */}
      <div className="mt-8 flex justify-between">
        <button
          type="button"
          onClick={handlePreviousQuestion}
          disabled={currentQuestionIndex === 0 || isLoading}
          className={`inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm ${
            currentQuestionIndex === 0
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          Previous
        </button>
        <button
          type="button"
          onClick={handleNextQuestion}
          disabled={isLoading}
          className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${
            isLoading
              ? 'bg-indigo-400 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {isLoading ? (
            <>
              <svg
                className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Submitting...
            </>
          ) : isLastQuestion ? (
            'Submit Assessment'
          ) : (
            'Next'
          )}
        </button>
      </div>
    </div>
  );
} 