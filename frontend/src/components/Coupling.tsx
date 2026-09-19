import { Field } from "@molarverse/pq-design";
import {
  MANOSTATS,
  PRESSURE_ISOTROPIES,
  THERMOSTATS,
} from "../conditionOptions";
import type { SimulationSetup } from "../types";

export type ThermostatSettings = Pick<
  SimulationSetup,
  | "thermostat"
  | "thermostat_relaxation_ps"
  | "thermostat_friction_ps_inverse"
  | "nh_chain_length"
  | "coupling_frequency_cm_inverse"
>;

export function TemperatureCoupling({
  value,
  onChange,
  controlId,
}: {
  value: ThermostatSettings;
  onChange: (patch: Partial<ThermostatSettings>) => void;
  controlId?: string;
}) {
  return (
    <section className="coupling-section" aria-label="Temperature coupling">
      <div className="form-grid coupling-grid">
        <Field label="Thermostat" controlId={controlId} wide>
          <select
            value={value.thermostat ?? "velocity_rescaling"}
            onChange={(event) => onChange({ thermostat: event.target.value })}
          >
            {THERMOSTATS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        {(value.thermostat === "berendsen" ||
          value.thermostat === "velocity_rescaling") && (
          <Field label="Relaxation time" unit="ps">
            <input
              type="number"
              min="0.000001"
              step="0.01"
              value={value.thermostat_relaxation_ps ?? ""}
              onChange={(event) =>
                onChange({
                  thermostat_relaxation_ps: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
            />
          </Field>
        )}
        {value.thermostat === "langevin" && (
          <Field label="Friction" unit="ps⁻¹">
            <input
              type="number"
              min="0"
              step="0.01"
              value={value.thermostat_friction_ps_inverse}
              onChange={(event) =>
                onChange({
                  thermostat_friction_ps_inverse: Number(event.target.value),
                })
              }
            />
          </Field>
        )}
        {value.thermostat === "nh-chain" && (
          <>
            <Field label="Chain length">
              <input
                type="number"
                min="1"
                step="1"
                value={value.nh_chain_length}
                onChange={(event) =>
                  onChange({ nh_chain_length: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Coupling freq." unit="cm⁻¹">
              <input
                type="number"
                min="0"
                step="1"
                value={value.coupling_frequency_cm_inverse}
                onChange={(event) =>
                  onChange({
                    coupling_frequency_cm_inverse: Number(event.target.value),
                  })
                }
              />
            </Field>
          </>
        )}
      </div>
    </section>
  );
}

export type ManostatSettings = Pick<
  SimulationSetup,
  | "manostat"
  | "manostat_relaxation_ps"
  | "compressibility_bar_inverse"
  | "pressure_isotropy"
>;

export function PressureCoupling({
  value,
  onChange,
  controlId,
}: {
  value: ManostatSettings;
  onChange: (patch: Partial<ManostatSettings>) => void;
  controlId?: string;
}) {
  return (
    <section className="coupling-section" aria-label="Pressure coupling">
      <div className="form-grid coupling-grid">
        <Field label="Manostat" controlId={controlId} wide>
          <select
            value={value.manostat ?? "stochastic_rescaling"}
            onChange={(event) => onChange({ manostat: event.target.value })}
          >
            {MANOSTATS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Relaxation time" unit="ps">
          <input
            type="number"
            min="0.000001"
            step="0.01"
            value={value.manostat_relaxation_ps ?? ""}
            onChange={(event) =>
              onChange({
                manostat_relaxation_ps: event.target.value
                  ? Number(event.target.value)
                  : null,
              })
            }
          />
        </Field>
        <Field label="Compressibility" unit="bar⁻¹">
          <input
            type="number"
            min="0"
            step="0.000001"
            value={value.compressibility_bar_inverse}
            onChange={(event) =>
              onChange({
                compressibility_bar_inverse: Number(event.target.value),
              })
            }
          />
        </Field>
        <Field label="Cell response" wide>
          <select
            value={value.pressure_isotropy}
            onChange={(event) =>
              onChange({
                pressure_isotropy:
                  event.target.value as SimulationSetup["pressure_isotropy"],
              })
            }
          >
            {PRESSURE_ISOTROPIES.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </section>
  );
}
