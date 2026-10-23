import { Link } from 'react-router-dom';

export default function Forbidden() {
  return (
    <div className="center-page">
      <div className="big">403</div>
      <h1>You do not have access to this page</h1>
      <p className="muted">Your role does not include this area. Ask an admin if you need access.</p>
      <Link to="/" className="btn btn-primary">
        Back to dashboard
      </Link>
    </div>
  );
}
