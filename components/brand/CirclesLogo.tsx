import Image from 'next/image';

export function CirclesLogo({
  width = 24,
  height = 24,
  className = '',
}: {
  className?: string;
  height?: number;
  width?: number;
}) {
  return (
    <Image
      src="/brand/trust-cleaner-logo.png"
      width={width}
      height={height}
      alt="Trust Cleaner"
      className={`rounded-sm object-contain ${className}`}
    />
  );
}
