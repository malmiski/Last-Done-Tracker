import React, { useState, useRef } from 'react';
import { View, ScrollView, TouchableOpacity } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import AutoHeightImage from './AutoHeightImage';

interface LargeImageGalleryProps {
  items: string[];
}

const LargeImageGallery: React.FC<LargeImageGalleryProps> = ({ items }) => {
  const [containerWidth, setContainerWidth] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleScroll = (event: any) => {
    if (containerWidth > 0) {
      const x = event.nativeEvent.contentOffset.x;
      const index = Math.round(x / containerWidth);
      if (index !== currentIndex) {
        setCurrentIndex(index);
      }
    }
  };

  return (
    <View
      style={{ position: 'relative', width: '100%', marginBottom: 15 }}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {containerWidth > 0 && (
        <ScrollView
          ref={scrollViewRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          {items.map((item, idx) => {
            if (item === "failed") return null;
            const source = { uri: item.startsWith('data:') ? item : `data:image/jpeg;base64,${item}` };
            return <AutoHeightImage key={idx} source={source} width={containerWidth} style={{ borderRadius: 10 }} />;
          })}
        </ScrollView>
      )}

      {items.length > 1 && (
        <>
          <TouchableOpacity
            style={{ position: 'absolute', left: 10, top: '50%', marginTop: -20, backgroundColor: currentIndex === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)', borderRadius: 20, padding: 5 }}
            onPress={() => {
               if (currentIndex > 0) {
                 scrollViewRef.current?.scrollTo({ x: (currentIndex - 1) * containerWidth, animated: true });
               }
            }}
            disabled={currentIndex === 0}
          >
            <Icon name="chevron-left" size={30} color={currentIndex === 0 ? 'rgba(0,0,0,0.3)' : '#000'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={{ position: 'absolute', right: 10, top: '50%', marginTop: -20, backgroundColor: currentIndex === items.length - 1 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)', borderRadius: 20, padding: 5 }}
            onPress={() => {
               if (currentIndex < items.length - 1) {
                 scrollViewRef.current?.scrollTo({ x: (currentIndex + 1) * containerWidth, animated: true });
               }
            }}
            disabled={currentIndex === items.length - 1}
          >
            <Icon name="chevron-right" size={30} color={currentIndex === items.length - 1 ? 'rgba(0,0,0,0.3)' : '#000'} />
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

export default LargeImageGallery;
