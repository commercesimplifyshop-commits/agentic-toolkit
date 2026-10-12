// Simulation clock in seconds. Mutable and outside React state so the 3D
// scene can read it every frame without triggering re-renders.
export const clock = { t: 0 }
