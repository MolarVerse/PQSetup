import Field from "./Field";

export interface ChoiceOption {
  value: string;
  label: string;
}

export interface ChoiceProps {
  label: string;
  value: string;
  options: readonly ChoiceOption[];
  info?: string;
  wide?: boolean;
  onChange: (value: string) => void;
}

/** Select field for a fixed list of options. */
export default function Choice({
  label,
  value,
  options,
  info,
  wide,
  onChange,
}: ChoiceProps) {
  return (
    <Field label={label} info={info} wide={wide}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
