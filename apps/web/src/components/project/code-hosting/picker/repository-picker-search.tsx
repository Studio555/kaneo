import { SearchIcon } from "lucide-react";
import type { KeyboardEvent } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

type RepositoryPickerSearchProps = {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
};

export function RepositoryPickerSearch({
  value,
  placeholder,
  onChange,
  onKeyDown,
}: RepositoryPickerSearchProps) {
  return (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        maxLength={100}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </InputGroup>
  );
}
