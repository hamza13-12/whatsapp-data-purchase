import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList, Alert, Button, Text } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { ThemedView } from './ThemedView';
import { ThemedText } from './ThemedText';
import { storeVoiceNote } from '../config/supabase';

// Try both possible paths for WhatsApp voice notes
const WHATSAPP_PATHS = [
  'file:///storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Voice Notes/',
  'file:///storage/emulated/0/WhatsApp/Media/WhatsApp Voice Notes/'
];

interface AudioFile {
  id: string; // uri
  name: string;
  uri: string;
  selected: boolean;
  timestamp: Date;
}

// Extended FileInfo type to include modificationTime
type ExtendedFileInfo = FileSystem.FileInfo & {
  modificationTime?: number;
};

export const AndroidDirectAccess = () => {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const tryDirectAccess = async () => {
      let foundFiles = false;
      let lastError = null;

      for (const basePath of WHATSAPP_PATHS) {
        try {
          console.log(`Trying path: ${basePath}`);
          const pathInfo = await FileSystem.getInfoAsync(basePath);

          if (!pathInfo.exists) {
            console.log(`Path does not exist: ${basePath}`);
            continue;
          }

          console.log(`Found valid path: ${basePath}`);
          const topLevelFolders = await FileSystem.readDirectoryAsync(basePath);
          console.log(`Found ${topLevelFolders.length} top level items`);

          const opusFilesPromises: Promise<AudioFile[]>[] = topLevelFolders.map(async (folderName) => {
            const subFolderPath = `${basePath}${folderName}`;
            try {
              const folderInfo = await FileSystem.getInfoAsync(subFolderPath);
              console.log(`Checking subfolder: ${subFolderPath}, isDirectory: ${folderInfo.isDirectory}`);

              if (!folderInfo.isDirectory) {
                return [];
              }

              const innerFileList = await FileSystem.readDirectoryAsync(subFolderPath);
              console.log(`Found ${innerFileList.length} files in ${folderName}`);

              const opusFilesInFolder: Promise<AudioFile>[] = innerFileList
                .filter(fileName => {
                  const isOpus = fileName.endsWith('.opus');
                  if (isOpus) {
                    console.log(`Found opus file: ${fileName}`);
                  }
                  return isOpus;
                })
                .map(async (fileName) => {
                  const fileUri = `${subFolderPath}/${fileName}`;
                  const info = await FileSystem.getInfoAsync(fileUri) as ExtendedFileInfo;
                  return {
                    id: fileUri,
                    name: fileName,
                    uri: fileUri,
                    selected: false,
                    timestamp: new Date(info.modificationTime ? info.modificationTime * 1000 : Date.now()),
                  };
                });
              return Promise.all(opusFilesInFolder);
            } catch (e) {
              console.warn(`Could not read subfolder: ${subFolderPath}`, e);
              return []; // Ignore folders we can't read
            }
          });

          const allOpusFileArrays = await Promise.all(opusFilesPromises);
          const allOpusFiles = allOpusFileArrays.flat();

          if (allOpusFiles.length > 0) {
            foundFiles = true;
            setFiles(allOpusFiles.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()));
            break;
          }
        } catch (err) {
          console.error(`Error accessing path ${basePath}:`, err);
          lastError = err;
        }
      }

      if (!foundFiles) {
        Alert.alert(
          'Direct Access Failed',
          'Could not automatically access WhatsApp voice notes. This can happen on modern Android versions due to privacy restrictions. Please use the main "Import WhatsApp Export" feature instead.'
        );
      }
      setIsLoading(false);
    };
    tryDirectAccess();
  }, []);


  const toggleFileSelection = (uri: string) => {
    setFiles(prevFiles =>
      prevFiles.map(file =>
        file.uri === uri ? { ...file, selected: !file.selected } : file
      )
    );
  };

  const exportSelectedFiles = async () => {
    const selectedFiles = files.filter(file => file.selected);
    if (selectedFiles.length === 0) {
      Alert.alert('No Files Selected', 'Please select one or more voice notes to export.');
      return;
    }

    setIsLoading(true);
    let exportedCount = 0;
    try {
      for (const file of selectedFiles) {
        const content = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        // We still don't have the real chat name, so we use a placeholder.
        await storeVoiceNote(file.name, 'Direct Android Import', file.timestamp.toISOString(), content);
        exportedCount++;
      }
      Alert.alert('Success', `Successfully exported ${exportedCount} voice notes to Supabase.`);
    } catch (err) {
      Alert.alert('Export Error', 'An error occurred while exporting files.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <ThemedView style={styles.center}><ThemedText>Scanning for voice notes...</ThemedText></ThemedView>;
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={files}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View style={[styles.fileItem, item.selected && styles.selectedItem]}>
            <ThemedText onPress={() => toggleFileSelection(item.uri)}>
              {item.name}
            </ThemedText>
            <ThemedText style={styles.timestampText}>
              {item.timestamp.toLocaleString()}
            </ThemedText>
          </View>
        )}
        ListEmptyComponent={<ThemedView style={styles.center}><ThemedText>No .opus voice notes found automatically.</ThemedText></ThemedView>}
      />
      <View style={styles.exportButtonContainer}>
        <Button title="Export Selected to Supabase" onPress={exportSelectedFiles} disabled={files.filter(f => f.selected).length === 0} />
      </View>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  fileItem: { padding: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  selectedItem: { backgroundColor: '#e0f7fa' },
  timestampText: { fontSize: 12, color: 'grey', marginTop: 4 },
  exportButtonContainer: { padding: 10 },
}); 