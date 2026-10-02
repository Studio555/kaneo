import { Input, type InputProps } from "@/components/ui/input";
import type { useSuggestionNavigation } from "@/hooks/use-suggestion-navigation";

type NavigationInputProps = ReturnType<
  typeof useSuggestionNavigation
>["inputProps"];

type SuggestionInputProps = Omit<InputProps, keyof NavigationInputProps> & {
  navigation: NavigationInputProps;
};

// Keep picker focus, keyboard handling, and ARIA wiring together.
export function SuggestionInput({
  navigation,
  ...props
}: SuggestionInputProps) {
  return <Input {...props} {...navigation} />;
}
