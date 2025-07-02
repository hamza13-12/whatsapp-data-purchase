import { AndroidDirectAccess } from '@/components/AndroidDirectAccess';
import { ThemedView } from '@/components/ThemedView';
import { StyleSheet } from 'react-native';

export default function AndroidDirectAccessScreen() {
  return (
    <ThemedView style={styles.container}>
      <AndroidDirectAccess />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
}); 