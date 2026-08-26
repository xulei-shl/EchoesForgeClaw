import React from 'react';
import { PhotoProvider, PhotoView } from 'react-photo-view';

interface SelectedItemBarProps {
  imageUrl: string;
  name: string;
}

export const SelectedItemBar = React.memo(({ imageUrl, name }: SelectedItemBarProps) => {
  if (!imageUrl) return null;
  return (
    <div className="flex items-center gap-2 p-2 mt-2 rounded-lg bg-paper-grid/20 border border-paper-grid">
      <PhotoProvider><PhotoView src={imageUrl}>
        <img src={imageUrl} alt={name} className="w-12 h-12 object-cover rounded-md cursor-pointer" />
      </PhotoView></PhotoProvider>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-ink truncate">{name}</p>
      </div>
    </div>
  );
});