import type { CSSProperties, JSX } from 'react';

interface IconProps {
  size?: number;
  color?: string;
  style?: CSSProperties;
  animated?: boolean;
}

function SvgIcon({
  size = 16,
  color = 'currentColor',
  style,
  children,
  viewBox = '0 0 16 16'
}: IconProps & { children: JSX.Element | JSX.Element[]; viewBox?: string }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

export function CloseIcon({ size = 20, color = 'currentColor', style }: IconProps): JSX.Element {
  return (
    <SvgIcon size={size} color={color} style={style} viewBox="0 0 20 20">
      <path d="M6 6L14 14" />
      <path d="M14 6L6 14" />
    </SvgIcon>
  );
}

export function ArrowUpIcon({ size = 16, color = 'currentColor', style }: IconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <path
        d="M7.29975 12.6663V5.02374L4.49506 7.82842C4.2217 8.10179 3.7782 8.10179 3.50483 7.82842C3.23146 7.55506 3.23146 7.11156 3.50483 6.83819L7.50483 2.83819L7.61518 2.74835C7.88685 2.56925 8.25599 2.59911 8.49506 2.83819L12.4951 6.83819C12.7684 7.11156 12.7684 7.55506 12.4951 7.82842C12.2217 8.10179 11.7782 8.10179 11.5048 7.82842L8.70014 5.02374V12.6663C8.70014 13.0529 8.38655 13.3665 7.99995 13.3665C7.61335 13.3665 7.29975 13.0529 7.29975 12.6663Z"
        fill={color}
      />
    </svg>
  );
}

export function StopIcon({ size = 16, color = 'currentColor', style }: IconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <rect x="3" y="3" width="10" height="10" rx="1.5" fill={color} />
    </svg>
  );
}

export function ChevronRightIcon({ size = 16, color = 'currentColor', style }: IconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <path
        d="M5.50483 2.8382C5.7782 2.56484 6.2217 2.56484 6.49506 2.8382L11.1621 7.5052C11.4351 7.77859 11.4353 8.22217 11.1621 8.49543L6.49506 13.1614C6.2217 13.4348 5.7782 13.4348 5.50483 13.1614C5.23163 12.8881 5.23152 12.4445 5.50483 12.1712L9.67573 7.99934L5.50483 3.82844C5.23146 3.55507 5.23146 3.11157 5.50483 2.8382Z"
        fill={color}
      />
    </svg>
  );
}

export function ChevronDownIcon({ size = 16, color = 'currentColor', style }: IconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <path
        d="M12.1713 5.50489C12.4446 5.23158 12.8882 5.23169 13.1616 5.50489C13.4349 5.77826 13.4349 6.22176 13.1616 6.49513L8.49555 11.1621C8.36435 11.2933 8.18597 11.3661 8.00044 11.3662C7.81494 11.3662 7.63656 11.2932 7.50532 11.1621L2.83833 6.49513C2.56496 6.22176 2.56496 5.77826 2.83833 5.50489C3.11169 5.23152 3.55519 5.23152 3.82856 5.50489L7.99946 9.67579L12.1713 5.50489Z"
        fill={color}
      />
    </svg>
  );
}

export function TrashIcon({ size = 16, color = 'currentColor', style }: IconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <path
        d="M3.30054 11.8662V4.7002H2.66675C2.28015 4.7002 1.96655 4.3866 1.96655 4C1.96655 3.6134 2.28015 3.2998 2.66675 3.2998H4.64526C4.64659 3.27359 4.64649 3.24765 4.64819 3.22266C4.66331 3.00129 4.69604 2.77746 4.78784 2.55566C4.99407 2.05779 5.38996 1.66159 5.88843 1.45508C6.11048 1.3631 6.33481 1.32957 6.5564 1.31445C6.77168 1.29978 7.0328 1.2998 7.33374 1.2998H8.66675C8.9678 1.2998 9.2288 1.29976 9.44409 1.31445C9.66553 1.32957 9.88921 1.36322 10.1111 1.45508C10.6095 1.66154 11.0054 2.05765 11.2117 2.55566C11.3035 2.77751 11.3372 3.00117 11.3523 3.22266C11.354 3.24768 11.3539 3.27356 11.3552 3.2998H13.3337C13.7202 3.29998 14.033 3.61351 14.033 4C14.033 4.38649 13.7202 4.70002 13.3337 4.7002H12.7V11.8691C12.7 12.23 12.7004 12.5428 12.6794 12.7998C12.6578 13.0651 12.6095 13.3323 12.4783 13.5898C12.2833 13.9724 11.9719 14.2837 11.5896 14.4785C11.3321 14.6097 11.0649 14.658 10.7996 14.6797C10.5426 14.7007 10.2298 14.7002 9.8689 14.7002H6.13159C5.7705 14.7002 5.45715 14.7007 5.19995 14.6797C4.93463 14.658 4.66751 14.6098 4.40991 14.4785C4.02682 14.2833 3.71584 13.9717 3.52124 13.5898C3.38994 13.3321 3.34275 13.0644 3.32104 12.7988C3.30004 12.5415 3.30054 12.2278 3.30054 11.8662ZM7.33374 2.7002C7.01354 2.7002 6.80776 2.70025 6.65112 2.71094C6.50174 2.72115 6.44772 2.7385 6.42456 2.74805C6.26979 2.81216 6.14623 2.93547 6.08179 3.09082C6.07265 3.11288 6.057 3.16355 6.04663 3.2998H9.95386C9.94348 3.1636 9.92786 3.11292 9.9187 3.09082C9.85432 2.93553 9.73081 2.81222 9.57593 2.74805C9.55292 2.73852 9.49869 2.72119 9.34839 2.71094C9.19183 2.70027 8.98678 2.7002 8.66675 2.7002H7.33374ZM4.69995 11.8662C4.69995 12.2511 4.70028 12.4984 4.71558 12.6855C4.7302 12.8643 4.75527 12.9266 4.76929 12.9541C4.83033 13.0738 4.92716 13.1711 5.04565 13.2314C5.07302 13.2454 5.13554 13.2696 5.31421 13.2842C5.50114 13.2994 5.74753 13.2998 6.13159 13.2998H9.8689C10.253 13.2998 10.4995 13.2995 10.6863 13.2842C10.8642 13.2696 10.9264 13.2454 10.9539 13.2314C11.0731 13.1707 11.1706 13.0731 11.2312 12.9541C11.2452 12.9267 11.2693 12.8642 11.2839 12.6855C11.2992 12.4988 11.3005 12.2529 11.3005 11.8691V4.7002H4.69995V11.8662Z"
        fill={color}
      />
    </svg>
  );
}

export function CircleCheckIcon({ size = 12, color = 'currentColor', style }: IconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <path
        d="M13.2998 8C13.2998 5.07289 10.9271 2.7002 8 2.7002C5.07289 2.7002 2.7002 5.07289 2.7002 8C2.7002 10.9271 5.07289 13.2998 8 13.2998C10.9271 13.2998 13.2998 10.9271 13.2998 8ZM9.50488 6.17188C9.77825 5.89851 10.2218 5.89851 10.4951 6.17188C10.7683 6.44526 10.7684 6.8888 10.4951 7.16211L7.82813 9.82813C7.55476 10.1015 7.11126 10.1015 6.83789 9.82813L5.50488 8.49512C5.23152 8.22175 5.23152 7.77825 5.50488 7.50488C5.77825 7.23152 6.22175 7.23152 6.49512 7.50488L7.33301 8.34277L9.50488 6.17188ZM14.7002 8C14.7002 11.7003 11.7003 14.7002 8 14.7002C4.29969 14.7002 1.2998 11.7003 1.2998 8C1.2998 4.29969 4.29969 1.2998 8 1.2998C11.7003 1.2998 14.7002 4.29969 14.7002 8Z"
        fill={color}
      />
    </svg>
  );
}

export function CircleXIcon({ size = 12, color = 'currentColor', style }: IconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <path
        d="M13.2998 8C13.2998 5.07289 10.9271 2.7002 8 2.7002C5.07289 2.7002 2.7002 5.07289 2.7002 8C2.7002 10.9271 5.07289 13.2998 8 13.2998C10.9271 13.2998 13.2998 10.9271 13.2998 8ZM9.50488 5.50488C9.77825 5.23156 10.2218 5.23153 10.4951 5.50488C10.7684 5.77824 10.7684 6.22176 10.4951 6.49512L8.99023 8L10.4951 9.50488C10.7684 9.77826 10.7685 10.2218 10.4951 10.4951C10.2218 10.7685 9.77826 10.7684 9.50488 10.4951L8 8.99023L6.49512 10.4951C6.22176 10.7684 5.77824 10.7684 5.50488 10.4951C5.23153 10.2218 5.23156 9.77825 5.50488 9.50488L7.00977 8L5.50488 6.49512C5.23152 6.22175 5.23152 5.77825 5.50488 5.50488C5.77825 5.23152 6.22175 5.23152 6.49512 5.50488L8 7.00977L9.50488 5.50488ZM14.7002 8C14.7002 11.7003 11.7003 14.7002 8 14.7002C4.29969 14.7002 1.2998 11.7003 1.2998 8C1.2998 4.29969 4.29969 1.2998 8 1.2998C11.7003 1.2998 14.7002 4.29969 14.7002 8Z"
        fill={color}
      />
    </svg>
  );
}

export function LoadingIcon({ size = 12, color = 'currentColor', style, animated = false }: IconProps): JSX.Element {
  const dotAnimation = (delayMs: number): CSSProperties =>
    animated
      ? {
          animation: 'exocor-loading-dot-wave 1.05s ease-in-out infinite',
          animationDelay: `${delayMs}ms`,
          transformOrigin: 'center',
          transformBox: 'fill-box'
        }
      : {};

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <circle cx="3" cy="7" r="1.025" fill={color} style={dotAnimation(0)} />
      <circle cx="6" cy="6" r="1.025" fill={color} style={dotAnimation(140)} />
      <circle cx="9" cy="5" r="1.025" fill={color} style={dotAnimation(280)} />
    </svg>
  );
}
