"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, BookOpen, Zap, Award, Calendar, CheckCircle, UserPlus, GraduationCap, BookmarkPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AcademicPlanChat from './AcademicPlanChat';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';

// Define types for the academic plan data structure
interface CourseRecommendation {
  name: string;
  description: string;
  type: 'required' | 'elective' | 'advanced';
  year: number;
  semester: 'Fall' | 'Spring' | 'Both';
  credits: number;
  prerequisites: string[];
}

interface AcademicPlan {
  focusAreas: string[];
  careerAlignment: string[];
  fourYearPlan: {
    freshman: CourseRecommendation[];
    sophomore: CourseRecommendation[];
    junior: CourseRecommendation[];
    senior: CourseRecommendation[];
  };
  extracurricularRecommendations: string[];
  summerActivities: string[];
  postGraduationRecommendations: string[];
}

export default function AcademicPlanPage() {
  const router = useRouter();
  const [academicPlan, setAcademicPlan] = useState<AcademicPlan | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [allAssessmentsCompleted, setAllAssessmentsCompleted] = useState(false);

  useEffect(() => {
    const fetchAcademicPlan = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('/api/academic-plan');
        const data = await response.json();
        
        if (response.ok) {
          setAcademicPlan(data.plan || null);
          setUserName(data.user?.name || '');
          setAllAssessmentsCompleted(data.allAssessmentsCompleted);
          
          // Log what we received to help debug
          console.log('Academic plan data received:', data);
        } else {
          setError(data.error || 'Failed to load academic plan');
          setAllAssessmentsCompleted(data.allAssessmentsCompleted || false);
        }
      } catch {
        setError('An error occurred while fetching your academic plan');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAcademicPlan();
  }, []);

  const generateAcademicPlan = async () => {
    try {
      setIsGenerating(true);
      setError(null);
      
      const response = await fetch('/api/academic-plan/generate', {
        method: 'POST',
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate academic plan');
      }
      
      // Refresh the page to show the newly generated plan
      window.location.reload();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An error occurred while generating your academic plan');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="container max-w-screen-xl mx-auto p-6">
        <div className="flex items-center gap-2 mb-6">
          <Button variant="ghost" onClick={() => router.push('/dashboard')} className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
        
        <div className="grid gap-6">
          <Skeleton className="w-2/3 h-12" />
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <Skeleton className="w-full h-[300px]" />
            </div>
            <div>
              <Skeleton className="w-full h-[300px]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state for incomplete assessments
  if (!allAssessmentsCompleted) {
    return (
      <div className="container max-w-screen-xl mx-auto p-6">
        <div className="flex items-center gap-2 mb-6">
          <Button variant="ghost" onClick={() => router.push('/dashboard')} className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
        
        <Alert className="mb-6">
          <BookOpen className="h-4 w-4" />
          <AlertTitle>Complete Your Assessments</AlertTitle>
          <AlertDescription>
            You need to complete all assessments before we can generate your personalized academic plan.
          </AlertDescription>
        </Alert>
        
        <Card>
          <CardHeader>
            <CardTitle>Academic Plan</CardTitle>
            <CardDescription>
              Your personalized plan will help you choose the right courses and activities to reach your goals.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookmarkPlus className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">Complete All Assessments First</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              To create your personalized academic plan, we need to understand your personality, skills, interests, and aptitudes through our assessments.
            </p>
            <Button onClick={() => router.push('/dashboard/assessments')}>
              Go to Assessments
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error && !academicPlan) {
    return (
      <div className="container max-w-screen-xl mx-auto p-6">
        <div className="flex items-center gap-2 mb-6">
          <Button variant="ghost" onClick={() => router.push('/dashboard')} className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
        
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        
        <Card>
          <CardHeader>
            <CardTitle>Academic Plan</CardTitle>
            <CardDescription>
              Your personalized plan will help you choose the right courses and activities to reach your goals.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookmarkPlus className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">Generate Your Academic Plan</h3>
            <p className="text-gray-700 text-center max-w-md mb-6">
              Based on your assessment results, we&apos;ll create a customized academic plan to help you achieve your college and career goals.
            </p>
            <Button onClick={generateAcademicPlan} disabled={isGenerating}>
              {isGenerating ? 'Generating...' : 'Generate Academic Plan'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show the academic plan
  return (
    <div className="container max-w-screen-xl mx-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-primary hover:text-primary/80 px-4 py-2 rounded-md">
          <ChevronLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        
        <div className="flex items-center gap-2">
          <Link 
            href="/dashboard/assessments/results"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >
            View Assessment Results
          </Link>
          <Button 
            onClick={generateAcademicPlan} 
            disabled={isGenerating}
          >
            {isGenerating ? 'Regenerating...' : 'Regenerate Plan'}
          </Button>
        </div>
      </div>
      
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      {/* Debug information */}
      {process.env.NODE_ENV !== 'production' && (
        <div className="mb-6 p-4 border rounded bg-gray-50">
          <h3 className="font-bold mb-2">Debug Info:</h3>
          <p>Academic Plan Data Received: {academicPlan ? 'Yes' : 'No'}</p>
          <p>Data structure: {JSON.stringify(academicPlan && typeof academicPlan)}</p>
          <p>Focus Areas: {academicPlan?.focusAreas ? `Found (${academicPlan.focusAreas.length})` : 'Not found'}</p>
          <p>Four Year Plan: {academicPlan?.fourYearPlan ? 'Found' : 'Not found'}</p>
          <pre className="text-xs mt-2 max-h-40 overflow-auto">
            {JSON.stringify(academicPlan, null, 2).substring(0, 500) + '...'}
          </pre>
        </div>
      )}
      
      <div className="grid gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">
            {userName ? `${userName}'s` : 'Your'} Academic Plan
          </h1>
          <p className="text-gray-700">
            A personalized 4-year plan to help you achieve your academic and career goals.
          </p>
        </div>
        
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Focus Areas Card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                <CardTitle>Focus Areas</CardTitle>
              </div>
              <CardDescription className="text-gray-700">
                Academic areas you should prioritize based on your assessments
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {academicPlan?.focusAreas.map((area, index) => (
                  <Badge key={index} variant="secondary" className="px-3 py-1">
                    {area}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
          
          {/* Career Alignment Card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5 text-primary" />
                <CardTitle>Career Alignment</CardTitle>
              </div>
              <CardDescription className="text-gray-700">
                Potential career paths that match your profile
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {academicPlan?.careerAlignment.map((career, index) => (
                  <Badge key={index} className="px-3 py-1">
                    {career}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
          
          {/* Extracurricular Activities Card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" />
                <CardTitle>Extracurricular Activities</CardTitle>
              </div>
              <CardDescription className="text-gray-700">
                Recommended activities to build your skills and applications
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {academicPlan?.extracurricularRecommendations.map((activity, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-1 flex-shrink-0" />
                    <span>{activity}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
        
        {/* Four Year Plan */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              <CardTitle>Four-Year Course Plan</CardTitle>
            </div>
            <CardDescription className="text-gray-700">
              Recommended courses for each year of high school
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="freshman">
              <TabsList className="grid grid-cols-4 mb-4">
                <TabsTrigger value="freshman">Freshman</TabsTrigger>
                <TabsTrigger value="sophomore">Sophomore</TabsTrigger>
                <TabsTrigger value="junior">Junior</TabsTrigger>
                <TabsTrigger value="senior">Senior</TabsTrigger>
              </TabsList>
              
              {['freshman', 'sophomore', 'junior', 'senior'].map((year) => (
                <TabsContent key={year} value={year} className="mt-0">
                  <ScrollArea className="h-[400px]">
                    <div className="grid gap-4">
                      {academicPlan?.fourYearPlan[year as keyof typeof academicPlan.fourYearPlan].map((course, index) => (
                        <Card key={index} className="overflow-hidden">
                          <div className={`h-2 ${
                            course.type === 'required' ? 'bg-blue-500' : 
                            course.type === 'advanced' ? 'bg-purple-500' : 'bg-green-500'
                          }`} />
                          <CardHeader className="py-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-base">{course.name}</CardTitle>
                              <Badge variant="outline">
                                {course.credits} {course.credits === 1 ? 'Credit' : 'Credits'}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={
                                course.type === 'required' ? 'default' : 
                                course.type === 'advanced' ? 'secondary' : 'outline'
                              } className="capitalize">
                                {course.type}
                              </Badge>
                              <Badge variant="outline">{course.semester}</Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="py-2">
                            <p className="text-sm text-gray-700">{course.description}</p>
                            
                            {course.prerequisites.length > 0 && (
                              <div className="mt-3">
                                <p className="text-xs font-medium mb-1">Prerequisites:</p>
                                <div className="flex flex-wrap gap-1">
                                  {course.prerequisites.map((prereq, i) => (
                                    <Badge key={i} variant="outline" className="text-xs">
                                      {prereq}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
        
        <div className="grid gap-6 md:grid-cols-2">
          {/* Summer Activities Card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-primary" />
                <CardTitle>Summer Activities</CardTitle>
              </div>
              <CardDescription className="text-gray-700">
                Recommended activities for summer breaks
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {academicPlan?.summerActivities.map((activity, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-1 flex-shrink-0" />
                    <span>{activity}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          
          {/* Post-Graduation Recommendations Card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                <CardTitle>Post-Graduation Recommendations</CardTitle>
              </div>
              <CardDescription className="text-gray-700">
                Suggested steps after high school graduation
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {academicPlan?.postGraduationRecommendations.map((rec, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-1 flex-shrink-0" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
        
        {/* Chat with AI Advisor */}
        <div>
          <h2 className="text-xl font-semibold mb-3">Ask About Your Academic Plan</h2>
          <p className="text-gray-700 mb-4">
            Have questions about your academic plan? Our AI advisor can help you understand your recommendations and make the most of your plan.
          </p>
          <AcademicPlanChat />
        </div>
      </div>
    </div>
  );
} 