import Pricing from '@/components/Pricing';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tarifs',
  description: 'Découvrez nos offres pour ClipTok.',
};

export default function PricingPage() {
  return <Pricing />;
}
