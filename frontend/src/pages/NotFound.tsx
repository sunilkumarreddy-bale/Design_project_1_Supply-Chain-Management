import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="center-page">
      <div className="big">404</div>
      <h1>Page not found</h1>
      <p className="muted">The page you are looking for does not exist or was moved.</p>
      <Link to="/" className="btn btn-primary">
        Back to dashboard
      </Link>
    </div>
  );
}
