import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import theme from '../src/theme/theme';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useActivityData } from '../src/hooks/useActivityData';
import { Tag } from '../src/data/activity-details';
import * as database from '../src/utils/database';

const ManageTagsScreen: React.FC = () => {
  const router = useRouter();
  const { tags, addTag, updateTag, deleteTag } = useActivityData();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState('#34C759');
  const [tagCounts, setTagCounts] = useState<{ [key: string]: number }>({});

  const colors = [
    '#34C759', '#FF3B30', '#007AFF', '#FF9500', '#AF52DE',
    '#5856D6', '#FFCC00', '#FF2D55', '#5AC8FA', '#8E8E93'
  ];

  useEffect(() => {
    const fetchCounts = async () => {
      const counts: { [key: string]: number } = {};
      for (const tag of tags) {
        counts[tag.id] = await database.getTagUsageCount(tag.id);
      }
      setTagCounts(counts);
    };
    fetchCounts();
  }, [tags]);

  const handleSaveTag = async () => {
    if (!tagName.trim()) {
      Alert.alert('Error', 'Tag name cannot be empty');
      return;
    }

    if (editingTag) {
      await updateTag({ ...editingTag, name: tagName, color: tagColor });
    } else {
      await addTag(tagName, tagColor);
    }
    closeModal();
  };

  const handleDeleteTag = (tag: Tag) => {
    Alert.alert(
      'Delete Tag',
      `Are you sure you want to delete "${tag.name}"? This will remove it from all entries.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteTag(tag.id) }
      ]
    );
  };

  const openModal = (tag?: Tag) => {
    if (tag) {
      setEditingTag(tag);
      setTagName(tag.name);
      setTagColor(tag.color);
    } else {
      setEditingTag(null);
      setTagName('');
      setTagColor(colors[0]);
    }
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditingTag(null);
    setTagName('');
    setTagColor(colors[0]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Icon name="arrow-left" size={30} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Manage Tags</Text>
        <TouchableOpacity onPress={() => openModal()}>
          <Icon name="plus" size={30} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={tags}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.tagItem}>
            <View style={[styles.tagPreview, { backgroundColor: item.color }]}>
              <Text style={styles.tagPreviewText}>{item.name}</Text>
            </View>
            <View style={styles.tagInfo}>
              <Text style={styles.tagUsageText}>{tagCounts[item.id] || 0} entries</Text>
            </View>
            <View style={styles.tagActions}>
              <TouchableOpacity onPress={() => openModal(item)} style={styles.actionButton}>
                <Icon name="pencil-outline" size={24} color={theme.colors.subtext} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDeleteTag(item)} style={styles.actionButton}>
                <Icon name="trash-can-outline" size={24} color={theme.colors.subtext} />
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editingTag ? 'Edit Tag' : 'New Tag'}</Text>

            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={tagName}
              onChangeText={setTagName}
              placeholder="Tag Name"
              placeholderTextColor={theme.colors.subtext}
            />

            <Text style={styles.label}>Color</Text>
            <View style={styles.colorGrid}>
              {colors.map(color => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorOption,
                    { backgroundColor: color },
                    tagColor === color && styles.selectedColorOption
                  ]}
                  onPress={() => setTagColor(color)}
                />
              ))}
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={closeModal}>
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.saveButton]} onPress={handleSaveTag}>
                <Text style={styles.modalButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  title: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: 'bold',
  },
  listContent: {
    padding: 20,
  },
  tagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
  },
  tagPreview: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 15,
  },
  tagPreviewText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  tagInfo: {
    flex: 1,
  },
  tagUsageText: {
    color: theme.colors.subtext,
    fontSize: 14,
  },
  tagActions: {
    flexDirection: 'row',
  },
  actionButton: {
    marginLeft: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: theme.colors.card,
    borderRadius: 20,
    padding: 25,
  },
  modalTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  label: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  input: {
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    marginBottom: 20,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 30,
    justifyContent: 'center',
  },
  colorOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  selectedColorOption: {
    borderWidth: 3,
    borderColor: theme.colors.text,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 15,
  },
  modalButton: {
    flex: 1,
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: theme.colors.disabled,
  },
  saveButton: {
    backgroundColor: theme.colors.primary,
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default ManageTagsScreen;
