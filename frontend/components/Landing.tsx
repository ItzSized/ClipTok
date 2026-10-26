import Hero from './landing/Hero';
import StatsBar from './landing/StatsBar';
import FeaturesGrid from './landing/FeaturesGrid';
import HowItWorks from './landing/HowItWorks';
import ComparisonTable from './landing/ComparisonTable';
import Testimonials from './landing/Testimonials';
import FAQ from './landing/FAQ';
import FooterCTA from './landing/FooterCTA';

export default function Landing({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div className="w-full max-w-6xl flex flex-col items-center relative z-10 py-12 gap-24">
      <div className="w-full">
        <Hero onGetStarted={onGetStarted} />
        <StatsBar />
        <FeaturesGrid />
      </div>
      <HowItWorks />
      <ComparisonTable />
      <Testimonials />
      <FAQ />
      <FooterCTA onGetStarted={onGetStarted} />
    </div>
  );
}
