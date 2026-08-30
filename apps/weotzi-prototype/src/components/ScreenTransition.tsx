import { motion, useReducedMotion } from 'framer-motion';
import type { HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';

export interface ScreenTransitionProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  direction?: 'back' | 'forward' | 'none';
}

export function ScreenTransition({
  children,
  className = '',
  direction = 'forward',
  ...props
}: ScreenTransitionProps) {
  const reduceMotion = useReducedMotion();
  const offset = direction === 'back' ? -10 : direction === 'forward' ? 10 : 0;

  return (
    <motion.div
      className={`screen-transition ${className}`.trim()}
      initial={reduceMotion ? false : { opacity: 0, y: offset }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: offset * -0.4 }}
      transition={{ duration: reduceMotion ? 0.01 : 0.28, ease: [0.22, 1, 0.36, 1] }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
