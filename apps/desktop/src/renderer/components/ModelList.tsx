import type { ModelInfo, ModelState } from '../../shared/models';
import { modelRow, type ModelAction, type ModelRow, type ModelRowContext } from '../settings/model-rows';

export type ModelSelection = { selected: string; onSelect: (id: string) => void };

type ModelListProps = {
  models: readonly ModelInfo[];
  states: readonly ModelState[];
  context: ModelRowContext;
  errors: Readonly<Record<string, string>>;
  onAction: (model: ModelInfo, action: ModelAction) => void;
  selection?: ModelSelection;
};

const EMPTY_STATE: Omit<ModelState, 'id' | 'totalBytes'> = { status: 'not-downloaded', receivedBytes: 0 };

function stateFor(model: ModelInfo, states: readonly ModelState[]): ModelState {
  return states.find((state) => state.id === model.id) ?? { id: model.id, totalBytes: model.sizeBytes, ...EMPTY_STATE };
}

export function ModelActions({ row, onAction }: { row: ModelRow; onAction: (action: ModelAction) => void }) {
  return (
    <div className="row-btns">
      {row.actions.map((button) => (
        <button
          key={button.action}
          type="button"
          className={button.action === 'delete' ? 'btn danger' : 'btn'}
          disabled={button.disabled}
          aria-label={`${button.label}: ${row.name}`}
          onClick={() => {
            onAction(button.action);
          }}
        >
          {button.label}
        </button>
      ))}
    </div>
  );
}

function ModelSummary({ row }: { row: ModelRow }) {
  return (
    <div className="model-info">
      <b>{row.name}</b>
      <span className="roles">
        {row.roles.map((role) => (
          <span key={role} className="chip">
            {role}
          </span>
        ))}
      </span>
      <span className="model-meta">
        <span>{row.size}</span>
        <span>Licencia {row.license}</span>
        <span className={row.active ? 'model-status active' : 'model-status'}>{row.status}</span>
      </span>
      {row.progress !== null && (
        <span className="progress" role="progressbar" aria-label={`Sťahovanie: ${row.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(row.progress * 100)}>
          <i style={{ width: `${row.progress * 100}%` }} />
        </span>
      )}
    </div>
  );
}

export function ModelList({ models, states, context, errors, onAction, selection }: ModelListProps) {
  return (
    <ul className="models" aria-label="Modely na prepis">
      {models.map((model) => {
        const row = modelRow(model, stateFor(model, states), context);
        return (
          <li key={model.id} className={row.active ? 'model active' : 'model'} data-model={model.id}>
            {selection !== undefined && (
              <label className="model-pick">
                <input
                  type="radio"
                  name="model-choice"
                  aria-label={row.name}
                  checked={selection.selected === model.id}
                  onChange={() => {
                    selection.onSelect(model.id);
                  }}
                />
                <ModelSummary row={row} />
              </label>
            )}
            {selection === undefined && (
              <>
                <ModelSummary row={row} />
                <ModelActions row={row} onAction={(action) => onAction(model, action)} />
              </>
            )}
            {errors[model.id] !== undefined && (
              <p className="field-note warn model-error" role="alert">
                {errors[model.id]}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function modelRowFor(model: ModelInfo, states: readonly ModelState[], context: ModelRowContext): ModelRow {
  return modelRow(model, stateFor(model, states), context);
}
