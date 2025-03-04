import { ICourse, ISemester } from '@/models/CourseTracker';

// Grade point values
export const gradePoints: Record<string, number> = {
  'A+': 4.0,
  'A': 4.0,
  'A-': 3.7,
  'B+': 3.3,
  'B': 3.0,
  'B-': 2.7,
  'C+': 2.3,
  'C': 2.0,
  'C-': 1.7,
  'D+': 1.3,
  'D': 1.0,
  'D-': 0.7,
  'F': 0.0,
  // Non-GPA impacting grades
  'P': -1, // Pass - not included in GPA
  'I': -1, // Incomplete - not included in GPA
  'W': -1  // Withdrawal - not included in GPA
};

// Additional points for honors and AP courses
export const courseTypeBonus: Record<string, number> = {
  'regular': 0.0,
  'honors': 0.5,
  'ap': 1.0
};

/**
 * Calculate the grade points for a single course
 */
export function calculateCourseGradePoints(course: ICourse): number {
  if (!course.grade || !gradePoints[course.grade] || gradePoints[course.grade] < 0) {
    return 0; // Return 0 for courses without a grade or with non-GPA grades
  }
  
  const basePoints = gradePoints[course.grade];
  const bonus = courseTypeBonus[course.courseType] || 0;
  
  return basePoints + bonus;
}

/**
 * Calculate the weighted GPA for a collection of courses
 */
export function calculateGPA(courses: ICourse[]): number {
  const completedCourses = courses.filter(
    course => course.completed && course.grade && gradePoints[course.grade] >= 0
  );
  
  if (completedCourses.length === 0) {
    return 0;
  }
  
  let totalPoints = 0;
  let totalCredits = 0;
  
  for (const course of completedCourses) {
    const points = calculateCourseGradePoints(course);
    totalPoints += points * course.credits;
    totalCredits += course.credits;
  }
  
  return totalCredits > 0 ? Number((totalPoints / totalCredits).toFixed(2)) : 0;
}

/**
 * Calculate GPA for each semester and the cumulative GPA
 */
export function calculateAllGPAs(semesters: ISemester[]): { 
  semestersWithGPA: ISemester[],
  cumulativeGPA: number,
  totalCredits: number
} {
  // Make a deep copy to avoid modifying the original
  const semestersWithGPA = JSON.parse(JSON.stringify(semesters)) as ISemester[];
  let allCompletedCourses: ICourse[] = [];
  let totalCredits = 0;
  
  // Calculate GPA for each semester
  for (const semester of semestersWithGPA) {
    const completedCourses = semester.courses.filter(
      course => course.completed && course.grade && gradePoints[course.grade] >= 0
    );
    
    if (completedCourses.length > 0) {
      semester.gpa = calculateGPA(completedCourses);
      
      // Track all completed courses for cumulative GPA
      allCompletedCourses = [...allCompletedCourses, ...completedCourses];
      
      // Calculate total credits
      const semesterCredits = completedCourses.reduce((sum, course) => sum + course.credits, 0);
      totalCredits += semesterCredits;
    } else {
      semester.gpa = 0;
    }
  }
  
  // Calculate cumulative GPA
  const cumulativeGPA = calculateGPA(allCompletedCourses);
  
  return {
    semestersWithGPA,
    cumulativeGPA,
    totalCredits
  };
}

/**
 * Format GPA for display
 */
export function formatGPA(gpa: number): string {
  return gpa.toFixed(2);
}

/**
 * Get letter grade from numeric grade
 */
export function getLetterGrade(percentage: number): string {
  if (percentage >= 97) return 'A+';
  if (percentage >= 93) return 'A';
  if (percentage >= 90) return 'A-';
  if (percentage >= 87) return 'B+';
  if (percentage >= 83) return 'B';
  if (percentage >= 80) return 'B-';
  if (percentage >= 77) return 'C+';
  if (percentage >= 73) return 'C';
  if (percentage >= 70) return 'C-';
  if (percentage >= 67) return 'D+';
  if (percentage >= 63) return 'D';
  if (percentage >= 60) return 'D-';
  return 'F';
} 