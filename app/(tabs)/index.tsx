import { StyleSheet } from 'react-native';
import { ThemedView } from '@/components/ThemedView';
import { ConversationSelector } from '@/components/ConversationSelector';

export default function HomeScreen() {
  return (
    <ThemedView style={styles.container}>
      <ConversationSelector />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
