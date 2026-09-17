import React from 'react';

interface InfoDisplayProps {
  message: string;
}

const InfoDisplay: React.FC<InfoDisplayProps> = ({ message }) => {
  return (
    <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg relative my-4 shadow-sm" role="status">
      <strong className="font-bold">Info: </strong>
      <span className="block sm:inline">{message}</span>
    </div>
  );
};

export default InfoDisplay;
