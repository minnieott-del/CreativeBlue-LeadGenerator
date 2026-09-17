import React from 'react';

interface SuccessDisplayProps {
  message: string;
}

const SuccessDisplay: React.FC<SuccessDisplayProps> = ({ message }) => {
  return (
    <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg relative my-4 shadow-sm" role="status">
      <strong className="font-bold">Success: </strong>
      <span className="block sm:inline">{message}</span>
    </div>
  );
};

export default SuccessDisplay;