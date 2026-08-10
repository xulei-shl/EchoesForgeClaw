import { createContext, useContext } from 'react';

interface CanvasContextType {
  scale: number;
}

export const CanvasContext = createContext<CanvasContextType>({ scale: 1 });

export const useCanvas = () => useContext(CanvasContext);
