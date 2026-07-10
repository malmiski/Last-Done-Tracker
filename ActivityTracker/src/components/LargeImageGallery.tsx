import React, { useState, useEffect, useRef } from 'react';
import { View, Image, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';

interface LargeImageGalleryProps {
  images: string[];
}

const LargeImageGallery: React.FC<LargeImageGalleryProps> = ({ images }) => {
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [imageSizes, setImageSizes] = useState<{ [key: number]: { width: number, height: number } }>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (containerWidth === 0) return;

    images.forEach((imgStr, idx) => {
      if (imgStr === "failed") return;
      const uri = imgStr.startsWith('data:') ? imgStr : `data:image/jpeg;base64,${imgStr}`;
      Image.getSize(uri, (width, height) => {
        let scaledWidth = width;
        let scaledHeight = height;

        if (width > containerWidth && width > 0) {
          const ratio = containerWidth / width;
          scaledWidth = containerWidth;
          scaledHeight = height * ratio;
        }

        setImageSizes((prev) => ({ ...prev, [idx]: { width: scaledWidth, height: scaledHeight } }));
      }, () => {
         // Fallback size if fetching fails
         setImageSizes((prev) => ({ ...prev, [idx]: { width: containerWidth, height: 200 } }));
      });
    });
  }, [images, containerWidth]);

  const maxHeight = Object.values(imageSizes).length > 0
      ? Math.max(...Object.values(imageSizes).map(s => s.height))
      : 200;

  const handleScroll = (event: any) => {
    const scrollPosition = event.nativeEvent.contentOffset.x;
    const index = Math.round(scrollPosition / containerWidth);
    if (index !== currentIndex && index >= 0 && index < images.length) {
      setCurrentIndex(index);
    }
  };

  const scrollTo = (index: number) => {
    if (scrollViewRef.current && containerWidth > 0) {
      scrollViewRef.current.scrollTo({ x: index * containerWidth, animated: true });
    }
  };

  return (
    <View
      style={styles.container}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {containerWidth > 0 && (
        <ScrollView
          ref={scrollViewRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          pagingEnabled={false}
          snapToInterval={containerWidth}
          snapToAlignment="start"
          decelerationRate="fast"
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          {images.map((imgStr, idx) => {
            if (imgStr === "failed") return null;
            const uri = imgStr.startsWith('data:') ? imgStr : `data:image/jpeg;base64,${imgStr}`;
            const size = imageSizes[idx] || { width: containerWidth, height: 200 };

            return (
              <View
                key={idx}
                style={{
                  width: containerWidth,
                  height: maxHeight,
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
              >
                <Image
                  source={{ uri }}
                  style={{ width: size.width, height: size.height, borderRadius: 10 }}
                  resizeMode="contain"
                />
              </View>
            );
          })}
        </ScrollView>
      )}

      {images.length > 1 && (
        <>
          <TouchableOpacity
            style={[
              styles.navButton,
              styles.navButtonLeft,
              { backgroundColor: currentIndex === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)' }
            ]}
            onPress={() => scrollTo(currentIndex - 1)}
            disabled={currentIndex === 0}
          >
            <Icon name="chevron-left" size={30} color={currentIndex === 0 ? 'rgba(0,0,0,0.3)' : '#000'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.navButton,
              styles.navButtonRight,
              { backgroundColor: currentIndex === images.length - 1 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)' }
            ]}
            onPress={() => scrollTo(currentIndex + 1)}
            disabled={currentIndex === images.length - 1}
          >
            <Icon name="chevron-right" size={30} color={currentIndex === images.length - 1 ? 'rgba(0,0,0,0.3)' : '#000'} />
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
    marginBottom: 15,
  },
  navButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -20,
    borderRadius: 20,
    padding: 5,
  },
  navButtonLeft: {
    left: 10,
  },
  navButtonRight: {
    right: 10,
  },
});

export default LargeImageGallery;
