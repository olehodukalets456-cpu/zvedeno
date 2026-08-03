"use client";

import { useEffect, useRef } from "react";

export function AmbientVisual() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    const drawingContext = canvasElement.getContext("2d");
    if (!drawingContext) return;

    const canvas: HTMLCanvasElement = canvasElement;
    const context: CanvasRenderingContext2D = drawingContext;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let animation = 0;
    let width = 0;
    let height = 0;
    let ratio = 1;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function draw() {
      context.clearRect(0, 0, width, height);
      const time = frame * 0.006;
      const centerX = width * 0.55;
      const centerY = height * 0.52;

      const glow = context.createRadialGradient(centerX, centerY, 8, centerX, centerY, Math.max(width, height) * 0.55);
      glow.addColorStop(0, "rgba(183,255,90,.19)");
      glow.addColorStop(.2, "rgba(79,156,255,.14)");
      glow.addColorStop(.52, "rgba(128,104,255,.08)");
      glow.addColorStop(1, "rgba(5,5,7,0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      context.save();
      context.translate(centerX, centerY);
      context.rotate(time * 0.18);
      for (let ring = 0; ring < 7; ring += 1) {
        const radiusX = Math.min(width * .36, 330) + ring * 26;
        const radiusY = radiusX * (.28 + ring * .018);
        context.beginPath();
        for (let segment = 0; segment <= 160; segment += 1) {
          const angle = (segment / 160) * Math.PI * 2;
          const wobble = Math.sin(angle * 4 + time * 2 + ring) * (5 + ring * 1.4);
          const x = Math.cos(angle) * (radiusX + wobble);
          const y = Math.sin(angle) * (radiusY + wobble * .26);
          if (segment === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.closePath();
        context.strokeStyle = ring % 3 === 0
          ? `rgba(183,255,90,${.12 - ring * .008})`
          : ring % 2 === 0
            ? `rgba(79,156,255,${.18 - ring * .012})`
            : `rgba(128,104,255,${.2 - ring * .014})`;
        context.lineWidth = ring === 0 ? 1.5 : .8;
        context.stroke();
      }
      context.restore();

      for (let particle = 0; particle < 42; particle += 1) {
        const seed = particle * 13.37;
        const orbit = 80 + (particle % 12) * 28;
        const angle = seed + time * (.25 + (particle % 5) * .035);
        const x = centerX + Math.cos(angle) * orbit;
        const y = centerY + Math.sin(angle * 1.4) * orbit * .35;
        const opacity = .16 + ((particle * 7) % 10) / 45;
        context.beginPath();
        context.arc(x, y, particle % 9 === 0 ? 2.2 : 1.1, 0, Math.PI * 2);
        context.fillStyle = particle % 4 === 0
          ? `rgba(183,255,90,${opacity})`
          : `rgba(178,178,255,${opacity})`;
        context.fill();
      }

      if (!reducedMotion) {
        frame += 1;
        animation = window.requestAnimationFrame(draw);
      }
    }

    resize();
    draw();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("resize", resize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      if (animation) window.cancelAnimationFrame(animation);
    };
  }, []);

  return <canvas className="aiHeroCanvas" ref={canvasRef} aria-hidden="true" />;
}
