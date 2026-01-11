import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default [
  {
    input: 'src/climate-scheduler-card.ts',
    output: {
      file: 'custom_components/climate_scheduler/frontend/climate-scheduler-card.js',
      format: 'es',
      sourcemap: true
    },
    plugins: [
      nodeResolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        sourceMap: true
      })
    ]
  },
  {
    input: 'src/keyframe-timeline.ts',
    output: {
      file: 'custom_components/climate_scheduler/frontend/keyframe-timeline.js',
      format: 'es',
      sourcemap: true
    },
    plugins: [
      nodeResolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        sourceMap: true
      })
    ]
  }
];
