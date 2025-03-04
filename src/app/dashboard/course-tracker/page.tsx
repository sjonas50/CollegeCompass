'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { ICourse, ISemester } from '@/models/CourseTracker';
import { formatGPA } from '@/lib/gpa-calculator';

// Default empty semester
const defaultSemester: ISemester = {
  term: 'fall',
  year: new Date().getFullYear(),
  courses: [
    {
      name: '',
      courseType: 'regular',
      credits: 1,
      semester: 'fall',
      year: new Date().getFullYear(),
      completed: false,
    },
  ],
  gpa: 0,
};

// Available course types
const courseTypes = [
  { value: 'regular', label: 'Regular' },
  { value: 'honors', label: 'Honors' },
  { value: 'ap', label: 'AP' },
];

// Available grades
const grades = [
  { value: 'A+', label: 'A+' },
  { value: 'A', label: 'A' },
  { value: 'A-', label: 'A-' },
  { value: 'B+', label: 'B+' },
  { value: 'B', label: 'B' },
  { value: 'B-', label: 'B-' },
  { value: 'C+', label: 'C+' },
  { value: 'C', label: 'C' },
  { value: 'C-', label: 'C-' },
  { value: 'D+', label: 'D+' },
  { value: 'D', label: 'D' },
  { value: 'D-', label: 'D-' },
  { value: 'F', label: 'F' },
  { value: 'I', label: 'Incomplete' },
  { value: 'W', label: 'Withdrawn' },
  { value: 'P', label: 'Pass' },
];

export default function CourseTrackerPage() {
  const [semesters, setSemesters] = useState<ISemester[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [cumulativeGpa, setCumulativeGpa] = useState<number>(0);
  const [totalCredits, setTotalCredits] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<string>('all');
  
  // Fetch course tracker data on mount
  useEffect(() => {
    const fetchCourseTracker = async () => {
      try {
        const response = await fetch('/api/course-tracker');
        const data = await response.json();
        
        if (data.courseTracker) {
          setSemesters(data.courseTracker.semesters || []);
          setCumulativeGpa(data.courseTracker.cumulativeGpa || 0);
          setTotalCredits(data.courseTracker.totalCredits || 0);
        }
      } catch (error) {
        console.error('Error fetching course tracker:', error);
        toast.error('Failed to load course data');
      } finally {
        setLoading(false);
      }
    };
    
    fetchCourseTracker();
  }, []);
  
  // Add a new semester
  const addSemester = () => {
    const newSemester = { ...defaultSemester };
    
    // Set the year and term based on the most recent semester
    if (semesters.length > 0) {
      const lastSemester = semesters[semesters.length - 1];
      
      if (lastSemester.term === 'fall') {
        newSemester.term = 'spring';
        newSemester.year = lastSemester.year;
      } else {
        newSemester.term = 'fall';
        newSemester.year = lastSemester.year + 1;
      }
    }
    
    // Update course year and semester
    newSemester.courses[0].year = newSemester.year;
    newSemester.courses[0].semester = newSemester.term;
    
    setSemesters([...semesters, newSemester]);
  };
  
  // Add a course to a semester
  const addCourse = (semesterIndex: number) => {
    const updatedSemesters = [...semesters];
    const semester = updatedSemesters[semesterIndex];
    
    const newCourse: ICourse = {
      name: '',
      courseType: 'regular',
      credits: 1,
      semester: semester.term,
      year: semester.year,
      completed: false,
    };
    
    updatedSemesters[semesterIndex].courses.push(newCourse);
    setSemesters(updatedSemesters);
  };
  
  // Remove a course from a semester
  const removeCourse = (semesterIndex: number, courseIndex: number) => {
    const updatedSemesters = [...semesters];
    
    // Don't remove the last course in a semester
    if (updatedSemesters[semesterIndex].courses.length === 1) {
      return;
    }
    
    updatedSemesters[semesterIndex].courses.splice(courseIndex, 1);
    setSemesters(updatedSemesters);
  };
  
  // Handle course field change
  const handleCourseChange = (
    semesterIndex: number,
    courseIndex: number,
    field: keyof ICourse,
    value: string | number | boolean
  ) => {
    const updatedSemesters = [...semesters];
    const course = updatedSemesters[semesterIndex].courses[courseIndex];
    
    course[field] = value as never; // Type assertion to satisfy TypeScript
    
    setSemesters(updatedSemesters);
  };
  
  // Save all course data
  const saveCourseData = async () => {
    setSaving(true);
    
    try {
      const response = await fetch('/api/course-tracker', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ semesters }),
      });
      
      const data = await response.json();
      
      if (data.courseTracker) {
        setSemesters(data.courseTracker.semesters || []);
        setCumulativeGpa(data.cumulativeGpa || 0);
        setTotalCredits(data.totalCredits || 0);
        toast.success('Course data saved successfully');
      } else {
        toast.error('Failed to save course data');
      }
    } catch (error) {
      console.error('Error saving course data:', error);
      toast.error('Failed to save course data');
    } finally {
      setSaving(false);
    }
  };
  
  // Remove a semester
  const removeSemester = (semesterIndex: number) => {
    const updatedSemesters = [...semesters];
    updatedSemesters.splice(semesterIndex, 1);
    setSemesters(updatedSemesters);
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-gray-600">Loading course data...</p>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto py-6">
      <div className="mb-8 space-y-4">
        <h1 className="text-3xl font-bold text-gray-900">Course Tracker & GPA Calculator</h1>
        <p className="text-lg text-gray-700">
          Track your courses, monitor your grades, and calculate your GPA across semesters.
        </p>
      </div>
      
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Cumulative GPA</CardTitle>
            <CardDescription>Overall grade point average</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-indigo-600">{formatGPA(cumulativeGpa)}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Total Credits</CardTitle>
            <CardDescription>Completed course credits</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-indigo-600">{totalCredits}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Semesters</CardTitle>
            <CardDescription>Total academic terms</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-indigo-600">{semesters.length}</div>
          </CardContent>
        </Card>
      </div>
      
      <div className="mb-6 flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Semester Courses</h2>
        <div className="space-x-2">
          <Button onClick={addSemester}>Add Semester</Button>
          <Button onClick={saveCourseData} disabled={saving} variant="outline">
            {saving ? 'Saving...' : 'Save All Changes'}
          </Button>
        </div>
      </div>
      
      {semesters.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-lg text-gray-600 mb-4">No semesters added yet.</p>
            <Button onClick={addSemester}>Add Your First Semester</Button>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="all">All Semesters</TabsTrigger>
            {semesters.map((semester, index) => (
              <TabsTrigger key={`tab-${index}`} value={`semester-${index}`}>
                {semester.term.charAt(0).toUpperCase() + semester.term.slice(1)} {semester.year}
              </TabsTrigger>
            ))}
          </TabsList>
          
          <TabsContent value="all">
            {semesters.map((semester, semesterIndex) => (
              <Card key={`all-semester-${semesterIndex}`} className="mb-6">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>
                      {semester.term.charAt(0).toUpperCase() + semester.term.slice(1)} {semester.year}
                    </CardTitle>
                    <CardDescription>
                      {semester.courses.length} courses | GPA: {formatGPA(semester.gpa || 0)}
                    </CardDescription>
                  </div>
                  <div className="flex space-x-2">
                    <Button size="sm" variant="outline" onClick={() => addCourse(semesterIndex)}>
                      Add Course
                    </Button>
                    <Button 
                      size="sm" 
                      variant="destructive" 
                      onClick={() => removeSemester(semesterIndex)}
                    >
                      Remove Semester
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[300px]">Course Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Credits</TableHead>
                        <TableHead>Grade</TableHead>
                        <TableHead>Completed</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {semester.courses.map((course, courseIndex) => (
                        <TableRow key={`all-course-${semesterIndex}-${courseIndex}`}>
                          <TableCell>
                            <Input
                              value={course.name}
                              onChange={(e) =>
                                handleCourseChange(semesterIndex, courseIndex, 'name', e.target.value)
                              }
                              placeholder="Enter course name"
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={course.courseType}
                              onValueChange={(value: string) =>
                                handleCourseChange(semesterIndex, courseIndex, 'courseType', value)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                              <SelectContent>
                                {courseTypes.map((type) => (
                                  <SelectItem key={`type-${type.value}`} value={type.value}>
                                    {type.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0.5"
                              step="0.5"
                              max="5"
                              value={course.credits}
                              onChange={(e) =>
                                handleCourseChange(
                                  semesterIndex,
                                  courseIndex,
                                  'credits',
                                  parseFloat(e.target.value) || 1
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={course.grade || ''}
                              onValueChange={(value: string) =>
                                handleCourseChange(semesterIndex, courseIndex, 'grade', value)
                              }
                              disabled={!course.completed}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select grade" />
                              </SelectTrigger>
                              <SelectContent>
                                {grades.map((grade) => (
                                  <SelectItem key={`grade-${grade.value}`} value={grade.value}>
                                    {grade.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={course.completed}
                                onChange={(e) =>
                                  handleCourseChange(
                                    semesterIndex,
                                    courseIndex,
                                    'completed',
                                    e.target.checked
                                  )
                                }
                                className="h-4 w-4 text-indigo-600 rounded"
                              />
                              <span className="text-sm">
                                {course.completed ? 'Completed' : 'In Progress'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeCourse(semesterIndex, courseIndex)}
                            >
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
          
          {semesters.map((semester, semesterIndex) => (
            <TabsContent key={`content-${semesterIndex}`} value={`semester-${semesterIndex}`}>
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>
                      {semester.term.charAt(0).toUpperCase() + semester.term.slice(1)} {semester.year}
                    </CardTitle>
                    <CardDescription>
                      {semester.courses.length} courses | GPA: {formatGPA(semester.gpa || 0)}
                    </CardDescription>
                  </div>
                  <div className="flex space-x-2">
                    <Button size="sm" variant="outline" onClick={() => addCourse(semesterIndex)}>
                      Add Course
                    </Button>
                    <Button 
                      size="sm" 
                      variant="destructive" 
                      onClick={() => removeSemester(semesterIndex)}
                    >
                      Remove Semester
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[300px]">Course Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Credits</TableHead>
                        <TableHead>Grade</TableHead>
                        <TableHead>Completed</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {semester.courses.map((course, courseIndex) => (
                        <TableRow key={`tab-course-${semesterIndex}-${courseIndex}`}>
                          <TableCell>
                            <Input
                              value={course.name}
                              onChange={(e) =>
                                handleCourseChange(semesterIndex, courseIndex, 'name', e.target.value)
                              }
                              placeholder="Enter course name"
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={course.courseType}
                              onValueChange={(value: string) =>
                                handleCourseChange(semesterIndex, courseIndex, 'courseType', value)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                              <SelectContent>
                                {courseTypes.map((type) => (
                                  <SelectItem key={`tab-type-${type.value}`} value={type.value}>
                                    {type.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0.5"
                              step="0.5"
                              max="5"
                              value={course.credits}
                              onChange={(e) =>
                                handleCourseChange(
                                  semesterIndex,
                                  courseIndex,
                                  'credits',
                                  parseFloat(e.target.value) || 1
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={course.grade || ''}
                              onValueChange={(value: string) =>
                                handleCourseChange(semesterIndex, courseIndex, 'grade', value)
                              }
                              disabled={!course.completed}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select grade" />
                              </SelectTrigger>
                              <SelectContent>
                                {grades.map((grade) => (
                                  <SelectItem key={`tab-grade-${grade.value}`} value={grade.value}>
                                    {grade.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={course.completed}
                                onChange={(e) =>
                                  handleCourseChange(
                                    semesterIndex,
                                    courseIndex,
                                    'completed',
                                    e.target.checked
                                  )
                                }
                                className="h-4 w-4 text-indigo-600 rounded"
                              />
                              <span className="text-sm">
                                {course.completed ? 'Completed' : 'In Progress'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeCourse(semesterIndex, courseIndex)}
                            >
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}
      
      <div className="mt-8 border-t pt-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">About GPA Calculation</h2>
        <div className="text-gray-700 space-y-3">
          <p>
            Your GPA is calculated using a weighted system based on course credits and course types.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Regular courses use standard grade points (A = 4.0, B = 3.0, etc.)</li>
            <li>Honors courses add 0.5 points to the grade value</li>
            <li>AP courses add 1.0 point to the grade value</li>
          </ul>
          <p>
            The cumulative GPA represents your overall average across all completed courses, weighted by credits.
          </p>
          <p className="font-semibold">
            Note: Incomplete (I), Withdrawal (W), and Pass (P) grades do not affect your GPA.
          </p>
        </div>
      </div>
    </div>
  );
} 