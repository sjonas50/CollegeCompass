'use client';

export default function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  // Determine the size of the spinner
  const sizeClass = 
    size === 'sm' ? 'h-4 w-4 border-2' : 
    size === 'lg' ? 'h-12 w-12 border-4' : 
    'h-8 w-8 border-3';
  
  return (
    <div className={`animate-spin rounded-full ${sizeClass} border-t-blue-600 border-r-transparent border-b-blue-600 border-l-transparent`}></div>
  );
} 