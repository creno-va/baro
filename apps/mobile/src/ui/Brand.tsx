import { Image, StyleSheet, View } from "react-native";
import { tokens } from "../theme/tokens";
import { Text } from "./Text";

/** Generated image references the existing shared SVG; it is decorative beside the name. */
export function Brand() {
  return (
    <View style={styles.brand}>
      <Image
        source={require("../../assets/brand/logo.png")}
        accessible={false}
        style={styles.logo}
      />
      <Text accessibilityRole="header" style={styles.name}>
        BARO
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: tokens.space.small, minWidth: 0 },
  logo: { width: 32, height: 32 },
  name: { fontSize: 24, lineHeight: 34, fontWeight: "700", flexShrink: 1 },
});
