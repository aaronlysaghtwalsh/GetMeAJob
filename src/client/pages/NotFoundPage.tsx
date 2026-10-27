import { Link } from '../lib/router';

export function NotFoundPage() {
  return (
    <div className="py-20 text-center">
      <h1 className="font-display text-2xl font-semibold text-ink">This page does not exist</h1>
      <p className="mt-2 text-sm text-graphite">The link may be out of date.</p>
      <Link to="/" className="mt-5 inline-block text-sm font-medium text-cobalt hover:underline">
        Go to Today
      </Link>
    </div>
  );
}
