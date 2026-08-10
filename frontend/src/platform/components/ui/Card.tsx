import React, { ReactNode } from 'react';
import clsx from 'clsx';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export const Card: React.FC<CardProps> = ({ children, className = '', ...props }) => (
  <div
    className={clsx(
      "bg-node-bg border border-dashed border-paper-grid rounded-lg shadow-[0_2px_8px_rgba(43,41,38,0.06)]",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export default Card;
