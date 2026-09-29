import logoUrl from '../assets/logo.svg'

export default function Logo({ size = 28 }: { size?: number }): React.JSX.Element {
  return <img src={logoUrl} width={size * 1.25} height={size * 1.25} className="logo" alt="" draggable={false} />
}
