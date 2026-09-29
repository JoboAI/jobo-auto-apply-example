import Link from 'next/link'
import {
  ArrowDown,
  ArrowRight,
  Check,
  CodeXml,
  FileText,
  Layers,
  ShieldCheck,
} from 'lucide-react'

/** An illustrative API exchange, not the status of a real application. */
export function ApplicationFlowGraphic() {
  return (
    <figure
      className="flow-visual"
      aria-label="Example Auto Apply workflow: a sandbox job and reviewed candidate data enter the API, which returns a confirmed submission."
    >
      <div className="flow-window">
        <div className="flow-window-bar">
          <span className="flow-window-title">
            <Layers size={14} /> Application workflow
          </span>
          <span className="flow-example">Example run</span>
        </div>
        <div className="flow-canvas">
          <div className="flow-job">
            <div className="flow-job-top">
              <span className="flow-company">
                N<span>↗</span>
              </span>
              <div>
                <span className="flow-overline">NORTHWIND ROBOTICS</span>
                <strong>Senior Software Engineer</strong>
                <span className="flow-job-meta">Remote · Engineering</span>
              </div>
            </div>
            <div className="flow-job-bottom">
              <span>
                <span className="flow-dot" />
                Sandbox job
              </span>
              <Link href="/signup" className="flow-apply">
                Apply with Jobo <ArrowRight size={13} />
              </Link>
            </div>
          </div>
          <div className="flow-vertical" aria-hidden="true">
            <span className="flow-wire" />
            <span className="flow-wire-label">application created</span>
            <ArrowDown size={12} />
          </div>
          <div className="flow-processing">
            <div className="flow-profile">
              <div className="flow-node-heading">
                <span className="flow-document">
                  <FileText size={16} />
                </span>
                <span>Candidate data</span>
              </div>
              <div className="flow-file">
                <strong>resume.pdf</strong>
                <span>Ready to attach</span>
              </div>
              <div className="flow-profile-line">
                <Check size={11} /> Reviewed profile
              </div>
              <div className="flow-profile-line">
                <Check size={11} /> Grounded answers
              </div>
            </div>
            <div className="flow-horizontal" aria-hidden="true">
              <ArrowRight size={12} />
            </div>
            <div className="flow-engine">
              <div className="flow-engine-heading">
                <span className="flow-engine-symbol">
                  <CodeXml size={18} />
                </span>
                <div>
                  <strong>Auto Apply</strong>
                  <span>FORM AUTOMATION API</span>
                </div>
              </div>
              <div className="flow-engine-rule" />
              <div className="flow-command">
                <span>Discover fields</span>
                <Check size={12} />
              </div>
              <div className="flow-command">
                <span>Fill & submit answers</span>
                <Check size={12} />
              </div>
              <span className="flow-engine-caption">
                Your answers. Our execution.
              </span>
            </div>
          </div>
          <div
            className="flow-vertical flow-vertical-result"
            aria-hidden="true"
          >
            <span className="flow-wire" />
            <span className="flow-wire-label">result returned</span>
            <ArrowDown size={12} />
          </div>
          <div className="flow-result">
            <span className="flow-result-icon">
              <Check size={19} />
            </span>
            <div>
              <strong>Application submitted</strong>
              <span>Confirmed by the Auto Apply API</span>
            </div>
            <ShieldCheck size={19} className="flow-result-seal" />
          </div>
        </div>
        <div className="flow-window-footer">
          <span className="flow-code-status">
            <span>status</span>: <b>"submitted"</b>
          </span>
          <span>Every step, accounted for.</span>
        </div>
      </div>
      <figcaption>
        <span className="flow-caption-line" />
        ILLUSTRATIVE SANDBOX WORKFLOW
        <span className="flow-caption-line" />
      </figcaption>
    </figure>
  )
}

export function IntegrationGraphic({
  kind,
}: {
  kind: 'profile' | 'application' | 'integration'
}) {
  return (
    <div className={`integration-graphic graphic-${kind}`} aria-hidden="true">
      {kind === 'profile' ? (
        <>
          <div className="mini-document">
            <FileText size={17} />
            <span />
            <span />
            <span />
          </div>
          <ArrowRight size={14} className="mini-connector" />
          <div className="mini-fields">
            <span>
              <i />
              Candidate details
              <Check size={10} />
            </span>
            <span>
              <i />
              Experience
              <Check size={10} />
            </span>
            <span>
              <i />
              Preferences
              <Check size={10} />
            </span>
          </div>
        </>
      ) : kind === 'application' ? (
        <div className="mini-pipeline">
          <span>
            <Layers size={16} />
            <small>Create</small>
          </span>
          <i />
          <span className="mini-pipeline-active">
            <CodeXml size={16} />
            <small>Answer</small>
          </span>
          <i />
          <span>
            <Check size={16} />
            <small>Submit</small>
          </span>
        </div>
      ) : (
        <div className="mini-terminal">
          <div>
            <span />
            <span />
            <span />
            <small>your-app.ts</small>
          </div>
          <code>
            <span>await</span> jobo.applications.<b>run</b>({'{'}
            <br />
            <i> apply_url:</i> <em>job.url</em>
            <br />
            {'}'}, {'{'} onStep {'}'})
          </code>
        </div>
      )}
    </div>
  )
}
