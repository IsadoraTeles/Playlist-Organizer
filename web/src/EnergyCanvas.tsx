import React, { useRef, useState, useEffect } from 'react';

interface EnergyCanvasProps {
    tracks: any[];
    onCurveGenerated: (points: number[]) => void;
    isDrawing: boolean;
    setIsDrawing: (v: boolean) => void;
}

const EnergyCanvas: React.FC<EnergyCanvasProps> = ({ tracks, onCurveGenerated, isDrawing, setIsDrawing }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);

    // Initialize & Resize
    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current && canvasRef.current) {
                const { width, height } = containerRef.current.getBoundingClientRect();
                canvasRef.current.width = width;
                canvasRef.current.height = height;

                const context = canvasRef.current.getContext('2d');
                if (context) {
                    context.lineWidth = 2; // Thinner line
                    context.lineCap = 'round';
                    context.lineJoin = 'round';
                    context.strokeStyle = '#1db954'; // Spotify Green
                    context.shadowColor = '#1db954';
                    context.shadowBlur = 0; // No glow for sharpness
                    setCtx(context);
                }
            }
        };

        window.addEventListener('resize', handleResize);
        // Delay slightly to ensure container is rendered
        setTimeout(handleResize, 50);

        return () => window.removeEventListener('resize', handleResize);
    }, [isDrawing]); // Re-run when drawing mode toggles to ensure size

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        if (!ctx || !canvasRef.current) return;

        // Clear previous drawing if starting new
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        ctx.beginPath();

        const { x, y } = getCoords(e);
        ctx.moveTo(x, y);
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        // Only draw if primary button is held (for mouse)
        if (('buttons' in e && e.buttons !== 1) && !('touches' in e)) return;
        if (!ctx) return;

        const { x, y } = getCoords(e);
        ctx.lineTo(x, y);
        ctx.stroke();
    };

    const stopDrawing = () => {
        if (!ctx) return;
        ctx.closePath();
        generateCurveData();
        // Optional: Turn off drawing mode? Or keep it for retries?
        // setIsDrawing(false); 
    };

    const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
        if (!canvasRef.current) return { x: 0, y: 0 };
        const rect = canvasRef.current.getBoundingClientRect();
        let clientX, clientY;

        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = (e as React.MouseEvent).clientX;
            clientY = (e as React.MouseEvent).clientY;
        }
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }

    const generateCurveData = () => {
        if (!canvasRef.current || !ctx) return;
        const width = canvasRef.current.width;
        const height = canvasRef.current.height;
        const points: number[] = [];

        // Sampling Strategy:
        // We want 1 energy value per track.
        // We scan the canvas at the X position corresponding to each track.
        // We find the Y position of the drawn line.

        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        for (let i = 0; i < tracks.length; i++) {
            // Center of the track's "slot"
            const x = Math.floor((i / tracks.length) * width + (width / tracks.length) / 2);

            // Scan column Y from Top (0) to Bottom (height)
            let foundY = -1;
            for (let y = 0; y < height; y++) {
                // Index in RGBA array
                const idx = (y * width + x) * 4;
                // Check Alpha > 50 (some presence)
                if (data[idx + 3] > 50) {
                    foundY = y;
                    break; // Use top-most pixel
                }
            }

            if (foundY !== -1) {
                // Normalize: Top(0) = 100%, Bottom(height) = 0%
                const energy = ((height - foundY) / height) * 100;
                points.push(Math.max(0, Math.min(100, energy)));
            } else {
                // Missing? Use previous or 50
                points.push(points.length > 0 ? points[points.length - 1] : 50);
            }
        }

        onCurveGenerated(points);
    };

    return (
        <div ref={containerRef} className="energy-canvas-overlay" style={{ pointerEvents: isDrawing ? 'auto' : 'none' }}>
            <canvas
                ref={canvasRef}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                // onMouseLeave={stopDrawing} // Don't trigger on leave, might just be sloppy drawing
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                className="drawing-layer"
            />
        </div>
    );
};

export default EnergyCanvas;
